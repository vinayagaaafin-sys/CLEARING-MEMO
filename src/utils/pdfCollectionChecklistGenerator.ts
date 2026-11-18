import { jsPDF } from 'jspdf';
import { ChequeEntry, ClearingBatch, CompanyBankAccount, CorporateProfile } from '../types/treasury';
import { formatIndianDate, formatINR } from './indianCurrency';

export interface BankChecklistGroup {
  key: string;
  bankName: string;
  branchName: string;
  branchAddress: string;
  ifscCode: string;
  accountNumber: string;
  items: {
    companyName: string;
    batchRef: string;
    cheque: ChequeEntry;
  }[];
  totalAmount: number;
}

function asciiSafe(text: string): string {
  return (text || '')
    .replace(/₹/g, 'Rs.')
    .replace(/–|—/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitText(pdf: jsPDF, text: string, maxWidth: number): string {
  const safe = asciiSafe(text);
  if (!safe) return '';
  if (pdf.getTextWidth(safe) <= maxWidth) return safe;
  let truncated = safe;
  while (truncated.length > 3 && pdf.getTextWidth(`${truncated}...`) > maxWidth) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
}

export function groupUncollectedByBankBranch(
  companies: {
    profile: CorporateProfile;
    bankAccounts: CompanyBankAccount[];
    batches: ClearingBatch[];
    cheques: ChequeEntry[];
  }[]
): BankChecklistGroup[] {
  const groupMap = new Map<string, BankChecklistGroup>();

  for (const comp of companies) {
    const batchMap = new Map(comp.batches.map((b) => [b.id, b]));
    const bankMap = new Map(comp.bankAccounts.map((a) => [a.id, a]));

    for (const chq of comp.cheques) {
      if (chq.status !== 'Returned / Bounced') continue;
      if ((chq.bankCollectionStatus || 'Pending Collection') !== 'Pending Collection') {
        continue;
      }

      const bank = bankMap.get(chq.companyBankAccountId) || comp.bankAccounts[0];
      const bankName = bank?.bankName || 'Deposit Bank';
      const branchName = bank?.branchName || 'Main Branch';
      const branchAddress = bank?.branchAddress || '';
      const ifscCode = bank?.ifscCode || '—';
      const accountNumber = bank?.accountNumber || '—';
      const key = `${bankName}__${branchName}__${accountNumber}`;

      let grp = groupMap.get(key);
      if (!grp) {
        grp = {
          key,
          bankName,
          branchName,
          branchAddress,
          ifscCode,
          accountNumber,
          items: [],
          totalAmount: 0,
        };
        groupMap.set(key, grp);
      }

      const batch = batchMap.get(chq.batchId);
      grp.items.push({
        companyName: comp.profile.companyName,
        batchRef: batch?.batchRef || '—',
        cheque: chq,
      });
      grp.totalAmount += chq.amount;
    }
  }

  return Array.from(groupMap.values()).sort((a, b) =>
    `${a.bankName} ${a.branchName}`.localeCompare(`${b.bankName} ${b.branchName}`)
  );
}

export function generateBankCollectionChecklistPDF(params: {
  companyLabel: string;
  groups: BankChecklistGroup[];
  generatedDate: string;
}): { filename: string; blobUrl: string } {
  const { companyLabel, groups, generatedDate } = params;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const LEFT = 12;
  const RIGHT = 198;
  const WIDTH = RIGHT - LEFT; // 186mm
  const PAGE_BOTTOM = 278;

  const COLS = [
    { label: 'Pick', x: 12, w: 9, align: 'center' as const },
    { label: 'S.No', x: 21, w: 9, align: 'center' as const },
    { label: 'Chq No.', x: 30, w: 20, align: 'left' as const },
    { label: 'Chq Date', x: 50, w: 21, align: 'left' as const },
    { label: 'Customer / Party Name', x: 71, w: 46, align: 'left' as const },
    { label: 'Amount (Rs.)', x: 117, w: 30, align: 'right' as const },
    { label: 'Return Reason', x: 147, w: 51, align: 'left' as const },
  ];

  let y = 14;
  let pageNo = 1;

  const drawTopHeader = (isContinuation: boolean) => {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(isContinuation ? 9.5 : 12);
    pdf.setTextColor(15, 23, 42);
    pdf.text(
      asciiSafe('BANK-WISE RETURNED CHEQUE COLLECTION CHECKLIST (FIELD STAFF)'),
      LEFT,
      y
    );

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(71, 85, 105);
    pdf.text(
      asciiSafe(`${companyLabel}  |  Date: ${formatIndianDate(generatedDate)}  |  Page ${pageNo}`),
      LEFT,
      y + 4.8
    );
    y += 7.5;
    pdf.setDrawColor(15, 23, 42);
    pdf.setLineWidth(0.5);
    pdf.line(LEFT, y, RIGHT, y);
    y += 5;
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_BOTTOM) {
      pdf.addPage('a4', 'portrait');
      pageNo += 1;
      y = 14;
      drawTopHeader(true);
    }
  };

  drawTopHeader(false);

  const totalCount = groups.reduce((s, g) => s + g.items.length, 0);
  const grandTotal = groups.reduce((s, g) => s + g.totalAmount, 0);

  // Executive Checklist Summary Box
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.25);
  pdf.rect(LEFT, y, WIDTH, 9, 'FD');
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(8);
  pdf.setTextColor(15, 23, 42);
  pdf.text(
    asciiSafe(
      `Banks / Branches to Visit: ${groups.length}    |    Uncollected Cheques: ${totalCount}    |    Total Value: ${formatINR(grandTotal, true)}`
    ),
    LEFT + 3,
    y + 5.7
  );
  y += 13;

  const drawTableHeader = () => {
    const hh = 7;
    pdf.setFillColor(241, 245, 249);
    pdf.setDrawColor(100, 116, 139);
    pdf.setLineWidth(0.25);
    pdf.rect(LEFT, y, WIDTH, hh, 'FD');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(15, 23, 42);
    for (const c of COLS) {
      if (c.x > LEFT) {
        pdf.setDrawColor(148, 163, 184);
        pdf.line(c.x, y, c.x, y + hh);
      }
      if (c.align === 'center') {
        pdf.text(c.label, c.x + c.w / 2, y + 4.7, { align: 'center' });
      } else if (c.align === 'right') {
        pdf.text(c.label, c.x + c.w - 2, y + 4.7, { align: 'right' });
      } else {
        pdf.text(c.label, c.x + 1.5, y + 4.7);
      }
    }
    y += hh;
  };

  for (const grp of groups) {
    ensureSpace(24);

    // Branch Banner
    pdf.setFillColor(11, 25, 44);
    pdf.rect(LEFT, y, WIDTH, 11.5, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.6);
    pdf.setTextColor(255, 255, 255);
    pdf.text(
      fitText(pdf, `${grp.bankName} - ${grp.branchName}`, 128),
      LEFT + 2.5,
      y + 4.6
    );
    pdf.setFont('courier', 'bold');
    pdf.setFontSize(7.8);
    pdf.text(
      asciiSafe(`${grp.items.length} Chq(s)  |  ${formatINR(grp.totalAmount, true)}`),
      RIGHT - 2.5,
      y + 4.6,
      { align: 'right' }
    );

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.9);
    pdf.setTextColor(203, 213, 225);
    pdf.text(
      fitText(
        pdf,
        `A/c: ${grp.accountNumber} | IFSC: ${grp.ifscCode}${grp.branchAddress ? ` | ${grp.branchAddress}` : ''}`,
        WIDTH - 5
      ),
      LEFT + 2.5,
      y + 9.2
    );
    y += 11.5;

    drawTableHeader();

    grp.items.forEach((entry, idx) => {
      const chq = entry.cheque;
      const reasonStr = asciiSafe(chq.bounceReason || 'Reason Not Specified');
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.8);
      const reasonLines = pdf.splitTextToSize(reasonStr, 48).slice(0, 2);
      const rowH = Math.max(8.5, reasonLines.length * 3.3 + 2.8);

      if (y + rowH > PAGE_BOTTOM) {
        pdf.addPage('a4', 'portrait');
        pageNo += 1;
        y = 14;
        drawTopHeader(true);
        drawTableHeader();
      }

      pdf.setDrawColor(203, 213, 225);
      pdf.setLineWidth(0.2);
      pdf.rect(LEFT, y, WIDTH, rowH, 'S');
      for (const c of COLS) {
        if (c.x > LEFT) {
          pdf.line(c.x, y, c.x, y + rowH);
        }
      }

      // Checkbox square for field staff tick-off
      pdf.setDrawColor(71, 85, 105);
      pdf.rect(14.8, y + 2.4, 3.4, 3.4, 'S');

      // S.No
      pdf.setFont('courier', 'normal');
      pdf.setFontSize(7.2);
      pdf.setTextColor(71, 85, 105);
      pdf.text(String(idx + 1), 25.5, y + 5, { align: 'center' });

      // Cheque No
      pdf.setFont('courier', 'bold');
      pdf.setTextColor(15, 23, 42);
      pdf.text(asciiSafe(chq.chequeNumber), 31.5, y + 5);

      // Cheque Date
      pdf.setFont('courier', 'normal');
      pdf.text(formatIndianDate(chq.chequeDate), 51.5, y + 5);

      // Party Name
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.2);
      pdf.text(fitText(pdf, chq.partyName, 43), 72.5, y + 3.9);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.4);
      pdf.setTextColor(100, 116, 139);
      pdf.text(fitText(pdf, `${chq.draweeBank} · ${entry.batchRef}`, 43), 72.5, y + 7);

      // Amount
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(7.4);
      pdf.setTextColor(15, 23, 42);
      pdf.text(formatINR(chq.amount, false), 145, y + 5, { align: 'right' });

      // Return Reason
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.8);
      pdf.setTextColor(153, 27, 27);
      pdf.text(reasonLines, 148.5, y + 3.9);

      y += rowH;
    });

    y += 5;
  }

  ensureSpace(18);
  pdf.setDrawColor(148, 163, 184);
  pdf.setLineWidth(0.3);
  pdf.line(LEFT, y + 4, RIGHT, y + 4);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(7.5);
  pdf.setTextColor(71, 85, 105);
  pdf.text(
    'Field Executive Sign & Date: __________________________',
    LEFT,
    y + 11
  );
  pdf.text(
    'Treasury Desk Verification Sign: __________________________',
    RIGHT,
    y + 11,
    { align: 'right' }
  );

  const safeDate = generatedDate.replace(/[^0-9-]/g, '');
  const filename = `Bank_Collection_Checklist_${safeDate}.pdf`;
  const blob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  pdf.save(filename);

  return { filename, blobUrl };
}
