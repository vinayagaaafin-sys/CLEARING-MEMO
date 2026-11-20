import { ChequeEntry, CompanyWorkspace } from '../types/treasury';

export const OVERDUE_GRACE_PERIOD_MS = 12 * 60 * 60 * 1000; // 12 hours
export const ALERT_REPEAT_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes (600,000 ms)
const ALERT_TRACKER_STORAGE_KEY = 'clearledger_returned_alert_tracker_v1';

export interface AlertTrackerRecord {
  lastAlertShownTime: number;
}

export type AlertTrackerMap = Record<string, AlertTrackerRecord>;

export interface OverdueChequeAlertItem {
  companyId: string;
  companyName: string;
  batchRef: string;
  depositBank: string;
  depositBranch: string;
  cheque: ChequeEntry;
  returnUpdatedTimestampIso: string;
  returnUpdatedMs: number;
  elapsedMs: number;
  lastAlertShownMs: number | null;
  isAlertDue: boolean;
  nextAlertInMs: number;
}

export interface OverdueEvaluationSummary {
  overdueItems: OverdueChequeAlertItem[];
  dueAlertItems: OverdueChequeAlertItem[];
  nextWakeupMs: number | null;
}

export function isChequePendingCollection(cheque: ChequeEntry): boolean {
  if (cheque.status !== 'Returned / Bounced') return false;
  return (cheque.bankCollectionStatus || 'Pending Collection') === 'Pending Collection';
}

export function resolveReturnUpdatedTimestampIso(cheque: ChequeEntry): string | null {
  if (cheque.returnUpdatedTimestamp) {
    const parsed = Date.parse(cheque.returnUpdatedTimestamp);
    if (!Number.isNaN(parsed)) return cheque.returnUpdatedTimestamp;
  }
  if (cheque.status !== 'Returned / Bounced') return null;

  if (cheque.updatedAt) {
    const parsed = Date.parse(cheque.updatedAt);
    if (!Number.isNaN(parsed)) return cheque.updatedAt;
  }
  if (cheque.bouncedDate && /^\d{4}-\d{2}-\d{2}$/.test(cheque.bouncedDate)) {
    return `${cheque.bouncedDate}T09:00:00.000Z`;
  }
  if (cheque.createdAt) {
    const parsed = Date.parse(cheque.createdAt);
    if (!Number.isNaN(parsed)) return cheque.createdAt;
  }
  return null;
}

export function getReturnUpdatedMs(cheque: ChequeEntry): number | null {
  const iso = resolveReturnUpdatedTimestampIso(cheque);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function getElapsedSinceReturnMs(
  cheque: ChequeEntry,
  nowMs: number = Date.now()
): number | null {
  const startMs = getReturnUpdatedMs(cheque);
  if (startMs === null) return null;
  return Math.max(0, nowMs - startMs);
}

export function isReturnedChequeOverdue(
  cheque: ChequeEntry,
  nowMs: number = Date.now()
): boolean {
  if (!isChequePendingCollection(cheque)) return false;
  const elapsed = getElapsedSinceReturnMs(cheque, nowMs);
  return elapsed !== null && elapsed >= OVERDUE_GRACE_PERIOD_MS;
}

export function getGraceRemainingMs(
  cheque: ChequeEntry,
  nowMs: number = Date.now()
): number | null {
  if (!isChequePendingCollection(cheque)) return null;
  const elapsed = getElapsedSinceReturnMs(cheque, nowMs);
  if (elapsed === null || elapsed >= OVERDUE_GRACE_PERIOD_MS) return null;
  return OVERDUE_GRACE_PERIOD_MS - elapsed;
}

export function formatExactElapsedDuration(
  elapsedMs: number,
  includeSeconds = false
): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  if (includeSeconds) {
    parts.push(`${String(seconds).padStart(2, '0')}s`);
  }
  return parts.join(' ');
}

export function formatVerboseElapsedDuration(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} ${days === 1 ? 'day' : 'days'}`);
  if (hours > 0 || days > 0) parts.push(`${hours} ${hours === 1 ? 'hr' : 'hrs'}`);
  parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`);
  parts.push(`${String(seconds).padStart(2, '0')} secs`);
  return parts.join(' ');
}

export function readAlertTrackerMap(): AlertTrackerMap {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(ALERT_TRACKER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const cleaned: AlertTrackerMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        v &&
        typeof v === 'object' &&
        typeof (v as AlertTrackerRecord).lastAlertShownTime === 'number' &&
        Number.isFinite((v as AlertTrackerRecord).lastAlertShownTime)
      ) {
        cleaned[k] = {
          lastAlertShownTime: (v as AlertTrackerRecord).lastAlertShownTime,
        };
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

export function writeAlertTrackerMap(map: AlertTrackerMap): void {
  try {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(ALERT_TRACKER_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota errors
  }
}

export function recordAlertShownForCheques(
  chequeIds: string[],
  timestampMs: number = Date.now()
): AlertTrackerMap {
  const current = readAlertTrackerMap();
  const next: AlertTrackerMap = { ...current };
  for (const id of chequeIds) {
    if (!id) continue;
    next[id] = { lastAlertShownTime: timestampMs };
  }
  writeAlertTrackerMap(next);
  return next;
}

export function clearAlertTrackerForCheques(chequeIds: string[]): void {
  if (chequeIds.length === 0) return;
  const current = readAlertTrackerMap();
  let changed = false;
  const next: AlertTrackerMap = { ...current };
  for (const id of chequeIds) {
    if (id in next) {
      delete next[id];
      changed = true;
    }
  }
  if (changed) {
    writeAlertTrackerMap(next);
  }
}

export function evaluateOverdueAlerts(
  companies: CompanyWorkspace[],
  nowMs: number = Date.now(),
  trackerOverride?: AlertTrackerMap
): OverdueEvaluationSummary {
  const tracker = trackerOverride ?? readAlertTrackerMap();
  const overdueItems: OverdueChequeAlertItem[] = [];
  let minFutureWakeupMs: number | null = null;

  const noteWakeup = (delayMs: number) => {
    const safeDelay = Math.max(250, delayMs);
    if (minFutureWakeupMs === null || safeDelay < minFutureWakeupMs) {
      minFutureWakeupMs = safeDelay;
    }
  };

  for (const comp of companies) {
    const batchMap = new Map(comp.batches.map((b) => [b.id, b]));
    const bankMap = new Map(comp.bankAccounts.map((a) => [a.id, a]));

    for (const chq of comp.cheques) {
      if (!isChequePendingCollection(chq)) continue;

      const returnIso = resolveReturnUpdatedTimestampIso(chq);
      if (!returnIso) continue;
      const returnMs = Date.parse(returnIso);
      if (Number.isNaN(returnMs)) continue;

      const elapsedMs = Math.max(0, nowMs - returnMs);
      if (elapsedMs < OVERDUE_GRACE_PERIOD_MS) {
        noteWakeup(OVERDUE_GRACE_PERIOD_MS - elapsedMs);
        continue;
      }

      const storedTrackerMs = tracker[chq.id]?.lastAlertShownTime ?? 0;
      const chequeLastAlertMs = chq.lastAlertShownTime
        ? Date.parse(chq.lastAlertShownTime)
        : 0;
      const bestLastMs = Math.max(
        Number.isFinite(storedTrackerMs) ? storedTrackerMs : 0,
        Number.isFinite(chequeLastAlertMs) ? chequeLastAlertMs : 0
      );
      const lastAlertShownMs = bestLastMs > 0 ? bestLastMs : null;

      const sinceLastAlertMs =
        lastAlertShownMs !== null ? Math.max(0, nowMs - lastAlertShownMs) : null;
      const isAlertDue =
        sinceLastAlertMs === null || sinceLastAlertMs >= ALERT_REPEAT_INTERVAL_MS;
      const nextAlertInMs =
        isAlertDue || sinceLastAlertMs === null
          ? 0
          : Math.max(0, ALERT_REPEAT_INTERVAL_MS - sinceLastAlertMs);

      if (!isAlertDue && nextAlertInMs > 0) {
        noteWakeup(nextAlertInMs);
      }

      const batch = batchMap.get(chq.batchId);
      const bank = bankMap.get(chq.companyBankAccountId) || comp.bankAccounts[0];

      overdueItems.push({
        companyId: comp.id,
        companyName: comp.profile.companyName,
        batchRef: batch?.batchRef || '—',
        depositBank: bank?.bankName || 'Deposit Bank',
        depositBranch: bank?.branchName || 'Main Branch',
        cheque: chq,
        returnUpdatedTimestampIso: returnIso,
        returnUpdatedMs: returnMs,
        elapsedMs,
        lastAlertShownMs,
        isAlertDue,
        nextAlertInMs,
      });
    }
  }

  // Sort oldest overdue first
  overdueItems.sort((a, b) => b.elapsedMs - a.elapsedMs);
  const dueAlertItems = overdueItems.filter((item) => item.isAlertDue);

  return {
    overdueItems,
    dueAlertItems,
    nextWakeupMs: minFutureWakeupMs,
  };
}
