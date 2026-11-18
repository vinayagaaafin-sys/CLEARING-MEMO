import * as XLSX from 'xlsx';
import { ChequeEntry, ClearingBatch, CompanyBankAccount, CorporateProfile } from '../types/treasury';
import { formatIndianDate } from './indianCurrency';

export interface ReturnedChequeExportItem {
  companyName: string;
  companyPan: string;
  batchRef: string;
  depositBank: string;
  depositBranch: string;
  cheque: ChequeEntry;
}

export function buildReturnedChequeExportItems(
  companies: {
    profile: CorporateProfile;
    bankAccounts: CompanyBankAccount[];
    batches: ClearingBatch[];
    cheques: ChequeEntry[];
  }[],
  chequeFilter?: (cheque: ChequeEntry, companyName: string) => boolean
): ReturnedChequeExportItem[] {
  const items: ReturnedChequeExportItem[] = [];

  for (const comp of companies) {
    const batchMap = new Map(comp.batches.map((b) => [b.id, b]));
    const bankMap = new Map(comp.bankAccounts.map((a) => [a.id, a]));

    for (const chq of comp.cheques) {
      if (
        chq.status !== 'Returned / Bounced' &&
        chq.status !== 'Settled / Recovered' &&
        chq.status !== 'Re-Deposited' &&
        !chq.bouncedDate
      ) {
        continue;
      }
      if (chequeFilter && !chequeFilter(chq, comp.profile.companyName)) continue;

      const batch = batchMap.get(chq.batchId);
      const bank = bankMap.get(chq.companyBankAccountId) || comp.bankAccounts[0];

      items.push({
        companyName: comp.profile.companyName,
        companyPan: comp.profile.pan,
        batchRef: batch?.batchRef || '—',
        depositBank: bank?.bankName || '—',
        depositBranch: bank?.branchName || '—',
        cheque: chq,
      });
    }
  }

  return items;
}

export function exportReturnedChequesToExcel(
  items: ReturnedChequeExportItem[],
  sheetTitle = 'Returned Cheques Report'
): string {
  const rows = items.map((item, idx) => {
    const c = item.cheque;
    const isRedeposited = c.status === 'Re-Deposited';
    const recovered = isRedeposited
      ? 0
      : Math.min(c.amount, Math.max(0, c.recoveredAmount ?? 0));
    const unrecovered = isRedeposited ? 0 : Math.max(0, c.amount - recovered);
    const collectionStatus = c.bankCollectionStatus || 'Pending Collection';
    const recoveryStatus = isRedeposited
      ? 'Re-Deposited'
      : c.recoveryStatus ||
        (recovered >= c.amount && c.amount > 0
          ? 'Recovered / Settled'
          : recovered > 0
          ? 'Partially Recovered'
          : 'Unrecovered');

    return {
      'S.No': idx + 1,
      Company: item.companyName,
      Batch: item.batchRef,
      'Cheque No': c.chequeNumber,
      'Cheque Date': formatIndianDate(c.chequeDate),
      'Bounced Date': c.bouncedDate ? formatIndianDate(c.bouncedDate) : '—',
      'Party / Customer Name': c.partyName,
      'Customer Code': c.customerCode || '—',
      'Invoice / Ref': c.invoiceRef || '—',
      'Deposit Bank': item.depositBank,
      'Deposit Branch': item.depositBranch,
      'Drawee Bank': c.draweeBank,
      'Drawee Branch': c.draweeBranch,
      'Amount (INR)': Number(c.amount.toFixed(2)),
      Status: c.status,
      'Return Reason': c.bounceReason || 'Not Specified',
      'Bank Collection Status': collectionStatus,
      'Collected Date': c.collectedFromBankDate
        ? formatIndianDate(c.collectedFromBankDate)
        : '—',
      'Collected By': c.collectedBy || '—',
      'Recovery Status': recoveryStatus,
      'Paid / Recovered Amount (INR)': Number(recovered.toFixed(2)),
      'Remaining Balance (INR)': Number(unrecovered.toFixed(2)),
      'Recovery Mode': c.recoveryMode || '—',
      'Recovery / Receipt / Replacement Ref':
        c.replacementChequeNumber
          ? `New Chq #${c.replacementChequeNumber}`
          : c.reDepositedToBatchRef
          ? `Re-Deposited (${c.reDepositedToBatchRef})`
          : c.recoveryRef || '—',
      'Recovery Date': c.recoveryDate ? formatIndianDate(c.recoveryDate) : '—',
      'Bounce Penalty (INR)': Number((c.penaltyAmount ?? 0).toFixed(2)),
      'Bounce Charges Collected (INR)': Number(
        (c.bounceChargesCollected ?? 0).toFixed(2)
      ),
      Remarks: c.remarks || '',
    };
  });

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0
      ? rows
      : [
          {
            Note: 'No returned cheques matched the selected filters.',
          },
        ]
  );

  ws['!cols'] = [
    { wch: 6 },  // S.No
    { wch: 36 }, // Company
    { wch: 24 }, // Batch
    { wch: 12 }, // Cheque No
    { wch: 14 }, // Cheque Date
    { wch: 14 }, // Bounced Date
    { wch: 32 }, // Party Name
    { wch: 14 }, // Customer Code
    { wch: 18 }, // Invoice Ref
    { wch: 22 }, // Deposit Bank
    { wch: 26 }, // Deposit Branch
    { wch: 22 }, // Drawee Bank
    { wch: 24 }, // Drawee Branch
    { wch: 16 }, // Amount
    { wch: 12 }, // Status
    { wch: 28 }, // Return Reason
    { wch: 20 }, // Collection Status
    { wch: 14 }, // Collected Date
    { wch: 20 }, // Collected By
    { wch: 20 }, // Recovery Status
    { wch: 18 }, // Recovered
    { wch: 18 }, // Unrecovered
    { wch: 18 }, // Recovery Mode
    { wch: 20 }, // Recovery Ref
    { wch: 14 }, // Recovery Date
    { wch: 18 }, // Penalty
    { wch: 20 }, // Bounce Charges Collected
    { wch: 30 }, // Remarks
  ];

  XLSX.utils.book_append_sheet(wb, ws, sheetTitle.slice(0, 31));

  // Build Summary & Analytics sheet
  const totalReturnedVal = items.reduce((s, i) => s + i.cheque.amount, 0);
  const pendingCollectionItems = items.filter(
    (i) =>
      i.cheque.status === 'Returned / Bounced' &&
      (i.cheque.bankCollectionStatus || 'Pending Collection') ===
        'Pending Collection'
  );
  const pendingCollectionVal = pendingCollectionItems.reduce(
    (s, i) => s + i.cheque.amount,
    0
  );
  const totalRecovered = items.reduce(
    (s, i) =>
      i.cheque.status === 'Re-Deposited'
        ? s
        : s +
          Math.min(i.cheque.amount, Math.max(0, i.cheque.recoveredAmount ?? 0)),
    0
  );
  const totalUnrecovered = items.reduce(
    (s, i) =>
      i.cheque.status === 'Re-Deposited'
        ? s
        : s +
          Math.max(
            0,
            i.cheque.amount -
              Math.min(
                i.cheque.amount,
                Math.max(0, i.cheque.recoveredAmount ?? 0)
              )
          ),
    0
  );

  const summaryRows = [
    { Metric: 'Generated On', Value: formatIndianDate(new Date().toISOString().slice(0, 10)) },
    { Metric: 'Total Returned Cheques (Count)', Value: items.length },
    { Metric: 'Total Returned Value (INR)', Value: Number(totalReturnedVal.toFixed(2)) },
    { Metric: 'Pending Bank Collection (Count)', Value: pendingCollectionItems.length },
    { Metric: 'Pending Bank Collection Value (INR)', Value: Number(pendingCollectionVal.toFixed(2)) },
    { Metric: 'Recovered / Settled Amount (INR)', Value: Number(totalRecovered.toFixed(2)) },
    { Metric: 'Unrecovered Balance (INR)', Value: Number(totalUnrecovered.toFixed(2)) },
  ];

  const summaryWs = XLSX.utils.json_to_sheet(summaryRows);
  summaryWs['!cols'] = [{ wch: 36 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Analytics Summary');

  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = `ClearLedger_Returned_Cheques_${dateTag}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}
