import { SEED_TREASURY_STATE } from '../data/seedData';
import {
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CompanyWorkspace,
  DayBookEntry,
  SystemAuditLogEntry,
  TreasuryState,
} from '../types/treasury';
import { getDefaultIndianBankHolidays } from '../utils/bankHolidays';
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
    const batches = Array.isArray(comp.batches) ? comp.batches : [];
    const cheques = Array.isArray(comp.cheques) ? comp.cheques : [];
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const defaultActor =
      comp.profile?.defaultMaker || comp.profile?.defaultChecker || 'Treasury Desk';
    const defaultChecker =
      comp.profile?.defaultChecker || comp.profile?.defaultMaker || 'Treasury Checker';

    for (const batch of batches) {
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

    for (const chq of cheques) {
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

const DEFAULT_PROFILE: CompanyWorkspace['profile'] = {
  companyName: 'Your Company Name',
  registeredAddress: '',
  pan: '',
  gstin: '',
  cin: '',
  contactPhone: '',
  treasuryEmail: '',
  defaultMaker: 'Maker',
  defaultChecker: 'Checker',
  checkerPassword: '',
  signatory1Name: '',
  signatory1Designation: '',
  signatory2Name: '',
  signatory2Designation: '',
};

export function buildDayBookDedupeKey(params: {
  companyBankAccountId: string;
  txDate: string;
  amount: number;
  direction: 'CR' | 'DR';
  narration: string;
}): string {
  const normNarration = String(params.narration || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const safeAmt = Number.isFinite(params.amount)
    ? Math.abs(params.amount).toFixed(2)
    : '0.00';
  return `${params.companyBankAccountId}|${params.txDate}|${safeAmt}|${params.direction}|${normNarration}`;
}

export function appendDeduplicatedDayBookEntries(
  existing: DayBookEntry[],
  incoming: DayBookEntry[]
): { entries: DayBookEntry[]; addedCount: number; skippedCount: number } {
  const seenKeys = new Set<string>(
    existing.map(
      (e) =>
        e.dedupeKey ||
        buildDayBookDedupeKey({
          companyBankAccountId: e.companyBankAccountId,
          txDate: e.txDate,
          amount: e.amount,
          direction: e.direction,
          narration: e.narration,
        })
    )
  );

  const toAdd: DayBookEntry[] = [];
  let skippedCount = 0;

  for (const item of incoming) {
    const key =
      item.dedupeKey ||
      buildDayBookDedupeKey({
        companyBankAccountId: item.companyBankAccountId,
        txDate: item.txDate,
        amount: item.amount,
        direction: item.direction,
        narration: item.narration,
      });
    if (seenKeys.has(key)) {
      skippedCount += 1;
      continue;
    }
    seenKeys.add(key);
    toAdd.push({ ...item, dedupeKey: key });
  }

  return {
    entries: [...existing, ...toAdd],
    addedCount: toAdd.length,
    skippedCount,
  };
}

function normalizeCompanyWorkspace(
  comp: Partial<CompanyWorkspace>,
  index: number,
  seedCustomersByCompany: Map<string, CompanyWorkspace['customers']>
): CompanyWorkspace {
  const id =
    typeof comp.id === 'string' && comp.id.trim()
      ? comp.id
      : `comp-migrated-${index + 1}`;
  const bankAccounts: CompanyBankAccount[] = Array.isArray(comp.bankAccounts)
    ? comp.bankAccounts.map((acc) => ({
        ...acc,
        openingBalance:
          typeof acc.openingBalance === 'number' &&
          Number.isFinite(acc.openingBalance)
            ? acc.openingBalance
            : 0,
        statementClosingBalance:
          typeof acc.statementClosingBalance === 'number' &&
          Number.isFinite(acc.statementClosingBalance)
            ? acc.statementClosingBalance
            : undefined,
      }))
    : [];
  const batches = Array.isArray(comp.batches) ? comp.batches : [];
  const cheques = Array.isArray(comp.cheques) ? comp.cheques : [];
  const hasCustomers = Array.isArray(comp.customers);
  const customers = hasCustomers
    ? comp.customers
    : seedCustomersByCompany.get(id) || [];
  const documents = Array.isArray(comp.documents) ? comp.documents : [];
  const letters = Array.isArray(comp.letters) ? comp.letters : [];
  const chequeSchedules = Array.isArray(comp.chequeSchedules)
    ? comp.chequeSchedules.map((sch) => ({
        ...sch,
        holidayAutoShift:
          typeof sch.holidayAutoShift === 'boolean' ? sch.holidayAutoShift : true,
        mode: sch.mode === 'manual' ? ('manual' as const) : ('auto' as const),
        cheques: Array.isArray(sch.cheques)
          ? sch.cheques.map((item, itemIdx) => ({
              ...item,
              effectiveDate: item.effectiveDate || item.originalDate,
              dueNumber:
                typeof item.dueNumber === 'number' && Number.isFinite(item.dueNumber)
                  ? item.dueNumber
                  : itemIdx + 1,
              amount:
                typeof item.amount === 'number' && Number.isFinite(item.amount)
                  ? item.amount
                  : 0,
              principalAmount:
                typeof item.principalAmount === 'number' &&
                Number.isFinite(item.principalAmount)
                  ? item.principalAmount
                  : undefined,
              interestAmount:
                typeof item.interestAmount === 'number' &&
                Number.isFinite(item.interestAmount)
                  ? item.interestAmount
                  : undefined,
            }))
          : [],
        scannedDocuments: Array.isArray(sch.scannedDocuments)
          ? sch.scannedDocuments
          : [],
      }))
    : [];
  const bankHolidays = Array.isArray(comp.bankHolidays)
    ? comp.bankHolidays
    : getDefaultIndianBankHolidays();
  const dayBookEntries: DayBookEntry[] = Array.isArray(comp.dayBookEntries)
    ? comp.dayBookEntries.map((entry) => ({
        ...entry,
        amount:
          typeof entry.amount === 'number' && Number.isFinite(entry.amount)
            ? Math.abs(entry.amount)
            : 0,
        dedupeKey:
          entry.dedupeKey ||
          buildDayBookDedupeKey({
            companyBankAccountId: entry.companyBankAccountId,
            txDate: entry.txDate,
            amount: entry.amount,
            direction: entry.direction,
            narration: entry.narration,
          }),
      }))
    : [];

  const hasValidActiveBatch =
    typeof comp.activeBatchId === 'string' &&
    batches.some((b) => b && b.id === comp.activeBatchId);

  return {
    ...comp,
    id,
    profile: {
      ...DEFAULT_PROFILE,
      ...(comp.profile || {}),
    },
    bankAccounts,
    batches,
    cheques,
    activeBatchId: hasValidActiveBatch
      ? (comp.activeBatchId as string)
      : batches[0]?.id || '',
    customers,
    documents,
    letters,
    chequeSchedules,
    bankHolidays,
    dayBookEntries,
  };
}

export function normalizeTreasuryState(
  rawInput: unknown
): TreasuryState | null {
  if (!rawInput || typeof rawInput !== 'object') return null;

  const parsed = rawInput as Partial<TreasuryState> &
    Partial<LegacyTreasuryState>;
  const seedCustomersByCompany = new Map(
    SEED_TREASURY_STATE.companies.map((c) => [c.id, c.customers || []])
  );

  // Multi-company format (merge every company & top-level field with defaults)
  if (Array.isArray(parsed.companies) && parsed.companies.length > 0) {
    const normalizedCompanies = (parsed.companies as unknown[])
      .filter((c): c is Partial<CompanyWorkspace> => Boolean(c && typeof c === 'object'))
      .map((comp, idx) =>
        normalizeCompanyWorkspace(comp, idx, seedCustomersByCompany)
      );

    if (normalizedCompanies.length === 0) return null;

    const hasValidActive = normalizedCompanies.some(
      (c) => c.id === parsed.activeCompanyId
    );
    const hasAuditArray = Array.isArray(parsed.auditLogs);
    const auditLogs = hasAuditArray
      ? (parsed.auditLogs as SystemAuditLogEntry[])
      : buildBackfillAuditLogs(normalizedCompanies);

    return {
      ...SEED_TREASURY_STATE,
      ...parsed,
      companies: normalizedCompanies,
      activeCompanyId: hasValidActive
        ? (parsed.activeCompanyId as string)
        : normalizedCompanies[0].id,
      auditLogs,
    };
  }

  // Legacy single-company format migration without losing data
  if (
    parsed.profile &&
    (Array.isArray(parsed.cheques) ||
      Array.isArray(parsed.bankAccounts) ||
      Array.isArray(parsed.batches))
  ) {
    const singleCompany = normalizeCompanyWorkspace(
      {
        id: 'comp-default',
        profile: parsed.profile,
        bankAccounts: Array.isArray(parsed.bankAccounts)
          ? parsed.bankAccounts
          : [],
        batches: Array.isArray(parsed.batches) ? parsed.batches : [],
        cheques: Array.isArray(parsed.cheques) ? parsed.cheques : [],
        activeBatchId: parsed.activeBatchId || '',
      },
      0,
      seedCustomersByCompany
    );

    const migratedCompanies = [singleCompany];
    return {
      activeCompanyId: singleCompany.id,
      companies: migratedCompanies,
      auditLogs: Array.isArray(parsed.auditLogs)
        ? (parsed.auditLogs as SystemAuditLogEntry[])
        : buildBackfillAuditLogs(migratedCompanies),
    };
  }

  return null;
}

export function loadTreasuryState(): TreasuryState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial: TreasuryState = {
        ...SEED_TREASURY_STATE,
        companies: SEED_TREASURY_STATE.companies.map((c) => ({
          ...c,
          letters: c.letters || [],
          customers: c.customers || [],
          documents: c.documents || [],
          chequeSchedules: c.chequeSchedules || [],
          bankHolidays: c.bankHolidays || getDefaultIndianBankHolidays(),
          dayBookEntries: c.dayBookEntries || [],
        })),
        auditLogs: buildBackfillAuditLogs(SEED_TREASURY_STATE.companies),
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
      return initial;
    }

    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeTreasuryState(parsed);
    if (normalized) {
      return normalized;
    }

    // Preserve unrecognized existing raw payload before falling back
    try {
      window.localStorage.setItem(`${STORAGE_KEY}_backup_raw`, raw);
    } catch {
      // Ignore quota errors
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
    companies: SEED_TREASURY_STATE.companies.map((c) => ({
      ...c,
      letters: c.letters || [],
      customers: c.customers || [],
      documents: c.documents || [],
      chequeSchedules: c.chequeSchedules || [],
      bankHolidays: c.bankHolidays || getDefaultIndianBankHolidays(),
      dayBookEntries: c.dayBookEntries || [],
    })),
    auditLogs: buildBackfillAuditLogs(SEED_TREASURY_STATE.companies),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
  return fresh;
}

export interface BackupExportResult {
  filename: string;
  companyCount: number;
  chequeCount: number;
  batchCount: number;
  dayBookCount: number;
}

export function exportFullBackupJson(state: TreasuryState): BackupExportResult {
  const payload = {
    app: 'ClearLedger Treasury',
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    state,
  };
  const jsonText = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = `ClearLedger_Full_Backup_${dateTag}.json`;
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  const chequeCount = state.companies.reduce(
    (sum, c) => sum + (c.cheques?.length || 0),
    0
  );
  const batchCount = state.companies.reduce(
    (sum, c) => sum + (c.batches?.length || 0),
    0
  );
  const dayBookCount = state.companies.reduce(
    (sum, c) => sum + (c.dayBookEntries?.length || 0),
    0
  );

  return {
    filename,
    companyCount: state.companies.length,
    chequeCount,
    batchCount,
    dayBookCount,
  };
}

export type ParsedBackupResult =
  | {
      ok: true;
      state: TreasuryState;
      exportedAt?: string;
      companyCount: number;
      chequeCount: number;
      batchCount: number;
      dayBookCount: number;
    }
  | {
      ok: false;
      error: string;
    };

export function parseBackupJsonState(jsonText: string): ParsedBackupResult {
  try {
    const rawParsed = JSON.parse(jsonText) as Record<string, unknown>;
    if (!rawParsed || typeof rawParsed !== 'object') {
      return { ok: false, error: 'Invalid JSON file: root object is missing.' };
    }

    const candidateState =
      rawParsed.state && typeof rawParsed.state === 'object'
        ? rawParsed.state
        : rawParsed;

    const normalized = normalizeTreasuryState(candidateState);
    if (!normalized) {
      return {
        ok: false,
        error:
          'This JSON file does not contain valid ClearLedger company, batch, or cheque data.',
      };
    }

    const chequeCount = normalized.companies.reduce(
      (sum, c) => sum + c.cheques.length,
      0
    );
    const batchCount = normalized.companies.reduce(
      (sum, c) => sum + c.batches.length,
      0
    );
    const dayBookCount = normalized.companies.reduce(
      (sum, c) => sum + (c.dayBookEntries?.length || 0),
      0
    );

    return {
      ok: true,
      state: normalized,
      exportedAt:
        typeof rawParsed.exportedAt === 'string'
          ? rawParsed.exportedAt
          : undefined,
      companyCount: normalized.companies.length,
      chequeCount,
      batchCount,
      dayBookCount,
    };
  } catch {
    return {
      ok: false,
      error: 'Could not parse JSON file. Please select a valid ClearLedger backup (.json).',
    };
  }
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
