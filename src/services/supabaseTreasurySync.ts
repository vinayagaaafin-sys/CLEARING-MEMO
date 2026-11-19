import {
  BankHoliday,
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CompanyWorkspace,
  CorporateProfile,
  CustomerChequeSchedule,
  CustomerDocument,
  CustomerProfile,
  DayBookEntry,
  SystemAuditAction,
  SystemAuditLogEntry,
  TreasuryState,
} from '../types/treasury';
import { isSupabaseConfigured, supabase } from './supabaseClient';
import { normalizeTreasuryState, saveTreasuryState } from './treasuryStore';

interface WorkspaceRow {
  id: string;
  sort_order: number;
  company_name: string;
  profile: CorporateProfile;
  bank_accounts: CompanyBankAccount[];
  batches: ClearingBatch[];
  cheques: ChequeEntry[];
  active_batch_id: string;
  customers: CustomerProfile[];
  documents: CustomerDocument[];
  letters: Record<string, unknown>[];
  cheque_schedules: CustomerChequeSchedule[];
  bank_holidays: BankHoliday[];
  day_book_entries: DayBookEntry[];
  updated_at: string;
}

interface AppMetaRow {
  id: string;
  active_company_id: string;
  updated_at: string;
}

interface AuditLogRow {
  id: string;
  timestamp: string;
  company_id: string;
  company_name: string;
  batch_id: string | null;
  batch_ref: string | null;
  cheque_id: string | null;
  cheque_number: string | null;
  customer_key: string | null;
  customer_name: string | null;
  document_id: string | null;
  document_title: string | null;
  action_type: string;
  actor: string;
  description: string;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, string | number> | null;
}

const APP_META_ID = 'default';
const AUDIT_CHUNK_SIZE = 200;

let writeQueue: Promise<void> = Promise.resolve();
let inFlightWrites = 0;
let lastLocalWriteCompletedAt = 0;
let lastSyncedSnapshot = '';

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const run = writeQueue.then(async () => {
    inFlightWrites += 1;
    try {
      await task();
    } finally {
      inFlightWrites = Math.max(0, inFlightWrites - 1);
      lastLocalWriteCompletedAt = Date.now();
    }
  });
  writeQueue = run.catch(() => {
    // Keep queue alive even if an individual write fails
  });
  return run;
}

function workspaceToRow(
  comp: CompanyWorkspace,
  sortOrder: number
): WorkspaceRow {
  return {
    id: comp.id,
    sort_order: sortOrder,
    company_name: comp.profile?.companyName || 'Unnamed Company',
    profile: comp.profile,
    bank_accounts: comp.bankAccounts || [],
    batches: comp.batches || [],
    cheques: comp.cheques || [],
    active_batch_id: comp.activeBatchId || '',
    customers: comp.customers || [],
    documents: comp.documents || [],
    letters: comp.letters || [],
    cheque_schedules: comp.chequeSchedules || [],
    bank_holidays: comp.bankHolidays || [],
    day_book_entries: comp.dayBookEntries || [],
    updated_at: new Date().toISOString(),
  };
}

function rowToWorkspace(row: WorkspaceRow): Partial<CompanyWorkspace> {
  return {
    id: row.id,
    profile: row.profile,
    bankAccounts: Array.isArray(row.bank_accounts) ? row.bank_accounts : [],
    batches: Array.isArray(row.batches) ? row.batches : [],
    cheques: Array.isArray(row.cheques) ? row.cheques : [],
    activeBatchId: row.active_batch_id || '',
    customers: Array.isArray(row.customers) ? row.customers : [],
    documents: Array.isArray(row.documents) ? row.documents : [],
    letters: Array.isArray(row.letters) ? row.letters : [],
    chequeSchedules: Array.isArray(row.cheque_schedules)
      ? row.cheque_schedules
      : [],
    bankHolidays: Array.isArray(row.bank_holidays) ? row.bank_holidays : [],
    dayBookEntries: Array.isArray(row.day_book_entries)
      ? row.day_book_entries
      : [],
  };
}

function auditLogToRow(log: SystemAuditLogEntry): AuditLogRow {
  return {
    id: log.id,
    timestamp: log.timestamp,
    company_id: log.companyId,
    company_name: log.companyName,
    batch_id: log.batchId ?? null,
    batch_ref: log.batchRef ?? null,
    cheque_id: log.chequeId ?? null,
    cheque_number: log.chequeNumber ?? null,
    customer_key: log.customerKey ?? null,
    customer_name: log.customerName ?? null,
    document_id: log.documentId ?? null,
    document_title: log.documentTitle ?? null,
    action_type: log.actionType,
    actor: log.actor,
    description: log.description,
    old_value: log.oldValue ?? null,
    new_value: log.newValue ?? null,
    metadata: log.metadata ?? null,
  };
}

function rowToAuditLog(row: AuditLogRow): SystemAuditLogEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    companyId: row.company_id,
    companyName: row.company_name,
    batchId: row.batch_id ?? undefined,
    batchRef: row.batch_ref ?? undefined,
    chequeId: row.cheque_id ?? undefined,
    chequeNumber: row.cheque_number ?? undefined,
    customerKey: row.customer_key ?? undefined,
    customerName: row.customer_name ?? undefined,
    documentId: row.document_id ?? undefined,
    documentTitle: row.document_title ?? undefined,
    actionType: row.action_type as SystemAuditAction,
    actor: row.actor,
    description: row.description,
    oldValue: row.old_value ?? undefined,
    newValue: row.new_value ?? undefined,
    metadata: row.metadata ?? undefined,
  };
}

async function upsertAuditLogsInChunks(
  logs: SystemAuditLogEntry[]
): Promise<void> {
  if (!supabase || logs.length === 0) return;
  for (let i = 0; i < logs.length; i += AUDIT_CHUNK_SIZE) {
    const chunk = logs.slice(i, i + AUDIT_CHUNK_SIZE).map(auditLogToRow);
    const { error } = await supabase
      .from('treasury_audit_logs')
      .upsert(chunk, { onConflict: 'id' });
    if (error) {
      throw new Error(`Audit log sync failed: ${error.message}`);
    }
  }
}

export async function fetchTreasuryStateFromSupabase(): Promise<{
  state: TreasuryState | null;
  empty: boolean;
}> {
  if (!supabase || !isSupabaseConfigured) {
    return { state: null, empty: false };
  }

  const [wsRes, metaRes, auditRes] = await Promise.all([
    supabase
      .from('treasury_workspaces')
      .select('*')
      .order('sort_order', { ascending: true }),
    supabase
      .from('treasury_app_meta')
      .select('*')
      .eq('id', APP_META_ID)
      .maybeSingle(),
    supabase
      .from('treasury_audit_logs')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(2500),
  ]);

  if (wsRes.error) {
    throw new Error(wsRes.error.message);
  }
  if (metaRes.error) {
    throw new Error(metaRes.error.message);
  }
  if (auditRes.error) {
    throw new Error(auditRes.error.message);
  }

  const wsRows = (wsRes.data || []) as WorkspaceRow[];
  if (wsRows.length === 0) {
    return { state: null, empty: true };
  }

  const metaRow = metaRes.data as AppMetaRow | null;
  const auditRows = (auditRes.data || []) as AuditLogRow[];

  const normalized = normalizeTreasuryState({
    companies: wsRows.map(rowToWorkspace),
    activeCompanyId: metaRow?.active_company_id || wsRows[0].id,
    auditLogs: auditRows.map(rowToAuditLog),
  });

  if (normalized) {
    lastSyncedSnapshot = JSON.stringify(normalized);
  }

  return { state: normalized, empty: false };
}

export async function replaceTreasuryStateInSupabase(
  nextState: TreasuryState
): Promise<boolean> {
  if (!supabase || !isSupabaseConfigured) return false;

  try {
    await enqueueWrite(async () => {
      if (!supabase) return;

      const { data: existingIdsData, error: listErr } = await supabase
        .from('treasury_workspaces')
        .select('id');
      if (listErr) throw new Error(listErr.message);

      const keepIds = new Set(nextState.companies.map((c) => c.id));
      const staleIds = (existingIdsData || [])
        .map((r: { id: string }) => r.id)
        .filter((id) => !keepIds.has(id));

      if (staleIds.length > 0) {
        const { error: delWsErr } = await supabase
          .from('treasury_workspaces')
          .delete()
          .in('id', staleIds);
        if (delWsErr) throw new Error(delWsErr.message);
      }

      const workspaceRows = nextState.companies.map((comp, idx) =>
        workspaceToRow(comp, idx)
      );
      if (workspaceRows.length > 0) {
        const { error: upsertWsErr } = await supabase
          .from('treasury_workspaces')
          .upsert(workspaceRows, { onConflict: 'id' });
        if (upsertWsErr) throw new Error(upsertWsErr.message);
      }

      const { error: metaErr } = await supabase
        .from('treasury_app_meta')
        .upsert(
          {
            id: APP_META_ID,
            active_company_id: nextState.activeCompanyId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );
      if (metaErr) throw new Error(metaErr.message);

      const { error: clearAuditErr } = await supabase
        .from('treasury_audit_logs')
        .delete()
        .neq('id', '');
      if (clearAuditErr) throw new Error(clearAuditErr.message);

      await upsertAuditLogsInChunks(nextState.auditLogs || []);
      lastSyncedSnapshot = JSON.stringify(nextState);
    });
    return true;
  } catch (err) {
    console.warn('[ClearLedger] Supabase full sync failed:', err);
    return false;
  }
}

export async function loadTreasuryStateFromSupabase(
  localFallback: TreasuryState
): Promise<TreasuryState | null> {
  if (!supabase || !isSupabaseConfigured) return null;

  try {
    const result = await fetchTreasuryStateFromSupabase();
    if (result.empty) {
      // Seed Supabase on first connect with current local/seed state
      await replaceTreasuryStateInSupabase(localFallback);
      return localFallback;
    }
    if (result.state) {
      saveTreasuryState(result.state);
      return result.state;
    }
    return null;
  } catch (err) {
    console.warn('[ClearLedger] Unable to load state from Supabase:', err);
    return null;
  }
}

export function syncTreasuryStateDiff(
  prevState: TreasuryState,
  nextState: TreasuryState
): Promise<void> {
  if (!supabase || !isSupabaseConfigured) return Promise.resolve();

  const prevCompaniesById = new Map(
    prevState.companies.map((c, idx) => [c.id, { comp: c, idx }])
  );
  const nextCompanyIds = new Set(nextState.companies.map((c) => c.id));

  const deletedCompanyIds = prevState.companies
    .map((c) => c.id)
    .filter((id) => !nextCompanyIds.has(id));

  const changedWorkspaces: WorkspaceRow[] = [];
  nextState.companies.forEach((comp, idx) => {
    const prevEntry = prevCompaniesById.get(comp.id);
    if (!prevEntry || prevEntry.comp !== comp || prevEntry.idx !== idx) {
      changedWorkspaces.push(workspaceToRow(comp, idx));
    }
  });

  const activeCompanyChanged =
    prevState.activeCompanyId !== nextState.activeCompanyId;

  const prevAuditIds = new Set((prevState.auditLogs || []).map((l) => l.id));
  const newAuditLogs = (nextState.auditLogs || []).filter(
    (l) => !prevAuditIds.has(l.id)
  );

  if (
    deletedCompanyIds.length === 0 &&
    changedWorkspaces.length === 0 &&
    !activeCompanyChanged &&
    newAuditLogs.length === 0
  ) {
    return Promise.resolve();
  }

  return enqueueWrite(async () => {
    if (!supabase) return;

    if (deletedCompanyIds.length > 0) {
      const { error } = await supabase
        .from('treasury_workspaces')
        .delete()
        .in('id', deletedCompanyIds);
      if (error) {
        console.warn('[ClearLedger] Workspace delete sync error:', error.message);
      }
    }

    if (changedWorkspaces.length > 0) {
      const { error } = await supabase
        .from('treasury_workspaces')
        .upsert(changedWorkspaces, { onConflict: 'id' });
      if (error) {
        console.warn('[ClearLedger] Workspace upsert sync error:', error.message);
      }
    }

    if (activeCompanyChanged) {
      const { error } = await supabase.from('treasury_app_meta').upsert(
        {
          id: APP_META_ID,
          active_company_id: nextState.activeCompanyId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
      if (error) {
        console.warn('[ClearLedger] Active company sync error:', error.message);
      }
    }

    if (newAuditLogs.length > 0) {
      try {
        await upsertAuditLogsInChunks(newAuditLogs);
      } catch (err) {
        console.warn('[ClearLedger] Audit log sync error:', err);
      }
    }

    lastSyncedSnapshot = JSON.stringify(nextState);
  });
}

export function subscribeToTreasurySync(
  onRemoteState: (remoteState: TreasuryState) => void
): () => void {
  if (!supabase || !isSupabaseConfigured) {
    return () => {};
  }

  let disposed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const pullRemoteState = async (ignoreEchoWindow = false) => {
    if (disposed) return;
    if (inFlightWrites > 0) return;
    if (!ignoreEchoWindow && Date.now() - lastLocalWriteCompletedAt < 1200) {
      return;
    }
    try {
      const result = await fetchTreasuryStateFromSupabase();
      if (disposed || !result.state) return;
      const incomingSnapshot = JSON.stringify(result.state);
      if (incomingSnapshot === lastSyncedSnapshot) return;
      lastSyncedSnapshot = incomingSnapshot;
      saveTreasuryState(result.state);
      onRemoteState(result.state);
    } catch {
      // Ignore transient network errors during background sync
    }
  };

  const schedulePull = () => {
    if (disposed) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void pullRemoteState(false);
    }, 250);
  };

  const channel = supabase
    .channel('clearledger-treasury-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'treasury_workspaces' },
      schedulePull
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'treasury_app_meta' },
      schedulePull
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'treasury_audit_logs' },
      schedulePull
    )
    .subscribe();

  const handleFocus = () => {
    void pullRemoteState(true);
  };

  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      void pullRemoteState(true);
    }
  };

  window.addEventListener('focus', handleFocus);
  document.addEventListener('visibilitychange', handleVisibility);

  return () => {
    disposed = true;
    if (debounceTimer) clearTimeout(debounceTimer);
    window.removeEventListener('focus', handleFocus);
    document.removeEventListener('visibilitychange', handleVisibility);
    if (supabase) {
      void supabase.removeChannel(channel);
    }
  };
}
