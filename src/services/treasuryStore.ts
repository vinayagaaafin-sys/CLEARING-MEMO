import { SEED_TREASURY_STATE } from '../data/seedData';
import {
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CompanyWorkspace,
  SystemAuditLogEntry,
  TreasuryState,
} from '../types/treasury';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';

const STORAGE_KEY = 'clearledger_treasury_state_v1';

interface LegacyTreasuryState {
  profile: CompanyWorkspace['profile'];
  bankAccounts: CompanyWorkspace['bankAccounts'];
  batches: CompanyWorkspace['batches'];
  cheques: CompanyWorkspace['cheques'];
  activeBatchId: string;
}

function toIsoTimestamp(dateOrIso?: string, fallbackTime = '05:00:00.000Z'): string {
  if (!dateOrIso) return new Date().toISOString();
  if (dateOrIso.includes('T')) return dateOrIso;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOrIso)) {
    return `${dateOrIso}T${fallbackTime}`;
  }
  return new Date().toISOString();
}

export function buildBackfillAuditLogs(
  companies: CompanyWorkspace[]
): SystemAuditLogEntry[] {
  const logs: SystemAuditLogEntry[] = [];
  const companyIds = new Set(companies.map((c) => c.id));
  const coveredBatchCreated = new Set<string>();
  const coveredBatchStatus = new Set<string>();
  const coveredChequeStatus = new Set<string>();

  for (const seedLog of SEED_TREASURY_STATE.auditLogs || []) {
    if (!companyIds.has(seedLog.companyId)) continue;
    logs.push(seedLog);
    if (seedLog.actionType === 'BATCH_CREATED' && seedLog.batchId) {
      coveredBatchCreated.add(seedLog.batchId);
    }
    if (seedLog.actionType === 'BATCH_STATUS_CHANGED' && seedLog.batchId) {
      coveredBatchStatus.add(seedLog.batchId);
    }
    if (seedLog.actionType === 'CHEQUE_STATUS_CHANGED' && seedLog.chequeId) {
      coveredChequeStatus.add(seedLog.chequeId);
    }
  }

  for (const comp of companies) {
    const batchMap = new Map(comp.batches.map((b) => [b.id, b]));
    const defaultActor =
      comp.profile.defaultMaker || comp.profile.defaultChecker || 'Treasury Desk';
    const defaultChecker =
      comp.profile.defaultChecker || comp.profile.defaultMaker || 'Treasury Checker';

    for (const batch of comp.batches) {
      if (!coveredBatchCreated.has(batch.id)) {
        logs.push({
          id: `aud-init-batch-${batch.id}`,
          timestamp: toIsoTimestamp(batch.depositDate, '04:05:00.000Z'),
          companyId: comp.id,
          companyName: comp.profile.companyName,
          batchId: batch.id,
          batchRef: batch.batchRef,
          actionType: 'BATCH_CREATED',
          actor: batch.makerName || defaultActor,
          description: `Created clearing batch ${batch.batchRef} scheduled for ${formatIndianDate(batch.depositDate)}.`,
          newValue: 'Draft',
        });
      }

      if (Array.isArray(batch.auditTrail)) {
        for (const aud of batch.auditTrail) {
          const actionType =
            aud.action === 'LOCKED'
              ? 'BATCH_LOCKED'
              : aud.action === 'UNLOCKED_BYPASS'
              ? 'BATCH_UNLOCKED'
              : 'BATCH_STATUS_CHANGED';
          if (actionType === 'BATCH_STATUS_CHANGED') {
            coveredBatchStatus.add(batch.id);
          }
          logs.push({
            id: `aud-trail-${batch.id}-${aud.id}`,
            timestamp: toIsoTimestamp(aud.timestamp),
            companyId: comp.id,
            companyName: comp.profile.companyName,
            batchId: batch.id,
            batchRef: batch.batchRef,
            actionType,
            actor: `${aud.actorName} (${aud.actorRole})`,
            description:
              aud.action === 'LOCKED'
                ? `Locked batch ${batch.batchRef} for print integrity.`
                : aud.action === 'UNLOCKED_BYPASS'
                ? `Unlocked batch ${batch.batchRef} via password bypass.${aud.reason ? ` Reason: ${aud.reason}` : ''}`
                : aud.reason || `Updated batch ${batch.batchRef} status.`,
          });
        }
      }

      if (
        batch.status &&
        batch.status !== 'Draft' &&
        !coveredBatchStatus.has(batch.id)
      ) {
        logs.push({
          id: `aud-init-bstatus-${batch.id}`,
          timestamp: toIsoTimestamp(batch.depositDate, '04:45:00.000Z'),
          companyId: comp.id,
          companyName: comp.profile.companyName,
          batchId: batch.id,
          batchRef: batch.batchRef,
          actionType: 'BATCH_STATUS_CHANGED',
          actor: batch.checkerName || defaultChecker,
          description: `Updated batch ${batch.batchRef} status from Draft to ${batch.status}.`,
          oldValue: 'Draft',
          newValue: batch.status,
        });
      }
    }

    for (const chq of comp.cheques) {
      const batch = batchMap.get(chq.batchId);
      logs.push({
        id: `aud-init-chq-${chq.id}`,
        timestamp: toIsoTimestamp(
          chq.createdAt || batch?.depositDate || chq.chequeDate,
          '04:15:00.000Z'
        ),
        companyId: comp.id,
        companyName: comp.profile.companyName,
        batchId: batch?.id,
        batchRef: batch?.batchRef,
        chequeId: chq.id,
        chequeNumber: chq.chequeNumber,
        actionType: 'CHEQUE_ADDED',
        actor: batch?.makerName || defaultActor,
        description: `Added cheque #${chq.chequeNumber} (${chq.partyName}, ${formatINR(chq.amount)}) to batch ${batch?.batchRef || ''}.`,
        newValue: chq.status,
      });

      if (
        !coveredChequeStatus.has(chq.id) &&
        (chq.status === 'Cleared' || chq.status === 'Returned / Bounced')
      ) {
        const statusDate =
          chq.status === 'Returned / Bounced'
            ? chq.bouncedDate || chq.updatedAt
            : chq.clearedDate || chq.updatedAt;
        logs.push({
          id: `aud-init-chqst-${chq.id}`,
          timestamp: toIsoTimestamp(statusDate, '05:15:00.000Z'),
          companyId: comp.id,
          companyName: comp.profile.companyName,
          batchId: batch?.id,
          batchRef: batch?.batchRef,
          chequeId: chq.id,
          chequeNumber: chq.chequeNumber,
          actionType: 'CHEQUE_STATUS_CHANGED',
          actor: batch?.checkerName || defaultChecker,
          description: `Cheque #${chq.chequeNumber} (${chq.partyName}, ${formatINR(chq.amount)}) status changed: Submitted to Bank → ${chq.status}${chq.status === 'Returned / Bounced' && chq.bounceReason ? ` (${chq.bounceReason})` : ''}.`,
          oldValue: 'Submitted to Bank',
          newValue: chq.status,
        });
      }

      if (
        (chq.recoveredAmount ?? 0) > 0 ||
        chq.bankCollectionStatus === 'Collected from Bank'
      ) {
        logs.push({
          id: `aud-init-rec-${chq.id}`,
          timestamp: toIsoTimestamp(
            chq.recoveryDate || chq.collectedFromBankDate || chq.updatedAt,
            '06:00:00.000Z'
          ),
          companyId: comp.id,
          companyName: comp.profile.companyName,
          batchId: batch?.id,
          batchRef: batch?.batchRef,
          chequeId: chq.id,
          chequeNumber: chq.chequeNumber,
          actionType: 'RECOVERY_UPDATED',
          actor: batch?.makerName || defaultActor,
          description: `Updated recovery/collection on returned cheque #${chq.chequeNumber} (${chq.partyName})${(chq.recoveredAmount ?? 0) > 0 ? `: Recovered ${formatINR(chq.recoveredAmount ?? 0)}` : ': Collected from Bank'}.`,
          newValue:
            chq.recoveryStatus || chq.bankCollectionStatus || 'Updated',
        });
      }
    }
  }

  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function loadTreasuryState(): TreasuryState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial: TreasuryState = {
        ...SEED_TREASURY_STATE,
        auditLogs: buildBackfillAuditLogs(SEED_TREASURY_STATE.companies),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }
    const parsed = JSON.parse(raw) as Partial<TreasuryState> & Partial<LegacyTreasuryState>;

    // Multi-company format
    if (parsed && Array.isArray(parsed.companies) && parsed.companies.length > 0) {
      const seedCustomersByCompany = new Map(
        SEED_TREASURY_STATE.companies.map((c) => [c.id, c.customers || []])
      );
      const normalizedCompanies = parsed.companies.map((comp) => {
        const hasCustomers =
          Array.isArray(comp.customers) && comp.customers.length > 0;
        return {
          ...comp,
          customers: hasCustomers
            ? comp.customers
            : seedCustomersByCompany.get(comp.id) || [],
          documents: Array.isArray(comp.documents) ? comp.documents : [],
        };
      });
      const hasValidActive = normalizedCompanies.some(
        (c) => c.id === parsed.activeCompanyId
      );
      const hasExistingLogs =
        Array.isArray(parsed.auditLogs) && parsed.auditLogs.length > 0;
      const nextLogs = hasExistingLogs
        ? (parsed.auditLogs as SystemAuditLogEntry[])
        : buildBackfillAuditLogs(normalizedCompanies);

      const loaded: TreasuryState = {
        companies: normalizedCompanies,
        activeCompanyId: hasValidActive
          ? (parsed.activeCompanyId as string)
          : normalizedCompanies[0].id,
        auditLogs: nextLogs,
      };
      if (!hasExistingLogs && nextLogs.length > 0) {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded));
      }
      return loaded;
    }

    // Migrate legacy single-company state cleanly without losing user data
    if (
      parsed &&
      parsed.profile &&
      Array.isArray(parsed.cheques) &&
      Array.isArray(parsed.bankAccounts) &&
      Array.isArray(parsed.batches)
    ) {
      const migratedCompanies: CompanyWorkspace[] = [
        {
          id: 'comp-bharat-precision',
          profile: parsed.profile,
          bankAccounts: parsed.bankAccounts,
          batches: parsed.batches,
          cheques: parsed.cheques,
          activeBatchId:
            parsed.activeBatchId || parsed.batches[0]?.id || 'batch-2026-0042',
        },
      ];
      const migrated: TreasuryState = {
        activeCompanyId: 'comp-bharat-precision',
        companies: migratedCompanies,
        auditLogs:
          Array.isArray(parsed.auditLogs) && parsed.auditLogs.length > 0
            ? parsed.auditLogs
            : buildBackfillAuditLogs(migratedCompanies),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return {
      ...SEED_TREASURY_STATE,
      auditLogs: buildBackfillAuditLogs(SEED_TREASURY_STATE.companies),
    };
  } catch {
    return {
      ...SEED_TREASURY_STATE,
      auditLogs: buildBackfillAuditLogs(SEED_TREASURY_STATE.companies),
    };
  }
}

export function saveTreasuryState(state: TreasuryState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function resetTreasuryState(): TreasuryState {
  const fresh: TreasuryState = {
    ...SEED_TREASURY_STATE,
    auditLogs: buildBackfillAuditLogs(SEED_TREASURY_STATE.companies),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

/**
 * Checks if a cheque with the same 6-digit number + drawee bank already exists
 */
export function findDuplicateCheque(
  cheques: ChequeEntry[],
  chequeNumber: string,
  draweeBank: string,
  excludeId?: string
): ChequeEntry | undefined {
  const normNo = chequeNumber.trim();
  const normBank = draweeBank.trim().toLowerCase();
  if (!normNo || !normBank) return undefined;
  const self = excludeId ? cheques.find((c) => c.id === excludeId) : undefined;
  return cheques.find(
    (c) =>
      c.id !== excludeId &&
      c.status !== 'Re-Deposited' &&
      c.id !== self?.reDepositedFromChequeId &&
      c.reDepositedFromChequeId !== excludeId &&
      c.chequeNumber.trim() === normNo &&
      c.draweeBank.trim().toLowerCase() === normBank
  );
}

/**
 * Generates Tally & SAP import-ready CSV file for filtered cheques
 */
export function exportChequesToCSV(
  cheques: ChequeEntry[],
  batches: ClearingBatch[],
  bankAccounts: CompanyBankAccount[]
): void {
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const accMap = new Map(bankAccounts.map((a) => [a.id, a]));

  const headers = [
    'Batch Ref No',
    'Deposit Date',
    'Deposit Bank',
    'Deposit Account No',
    'Deposit IFSC',
    'Clearing Type',
    'Cheque Date',
    'Cheque Number',
    'MICR Code',
    'Drawee Bank',
    'Drawee Branch',
    'Party / Customer Name',
    'Customer Code',
    'Invoice / Ref No',
    'Amount (INR)',
    'Status',
    'Maker (Prepared By)',
    'Checker (Approved By)',
    'Bounce Reason',
    'Bounce Penalty (INR)',
    'Remarks',
  ];

  const escapeCsv = (val: string | number | undefined) => {
    const str = val === undefined || val === null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const rows = cheques.map((c) => {
    const batch = batchMap.get(c.batchId);
    const acc = accMap.get(c.companyBankAccountId);
    return [
      batch?.batchRef ?? '',
      batch ? formatIndianDate(batch.depositDate) : '',
      acc?.bankName ?? '',
      acc ? `'${acc.accountNumber}` : '', // Leading apostrophe preserves long account numbers in Excel
      acc?.ifscCode ?? '',
      c.clearingType,
      formatIndianDate(c.chequeDate),
      `'${c.chequeNumber}`,
      `'${c.micrCode}`,
      c.draweeBank,
      c.draweeBranch,
      c.partyName,
      c.customerCode,
      c.invoiceRef,
      c.amount.toFixed(2),
      c.status,
      batch?.makerName ?? '',
      batch?.checkerName ?? '',
      c.bounceReason ?? '',
      c.penaltyAmount ? c.penaltyAmount.toFixed(2) : '',
      c.remarks ?? '',
    ]
      .map(escapeCsv)
      .join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(escapeCsv).join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const timestamp = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.setAttribute('download', `ClearLedger_Tally_SAP_Export_${timestamp}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
