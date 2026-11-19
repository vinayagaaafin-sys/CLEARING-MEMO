import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarCheck2,
  CheckCircle2,
  Download,
  FileCheck2,
  FilePlus2,
  History,
  Landmark,
  LayoutDashboard,
  Menu,
  Plus,
  Printer,
  ScrollText,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { AddCompanyModal } from './components/AddCompanyModal';
import { BankHolidayDrawer } from './components/BankHolidayDrawer';
import { ReconcileConfirmItem } from './components/BankStatementReconcileModal';
import { CustomerScheduleView } from './components/CustomerScheduleView';
import {
  CustomerInitialSelection,
  CustomersView,
} from './components/CustomersView';
import { SendToClearingSelection } from './components/DailyDepositScheduleWidget';
import { DashboardView } from './components/DashboardView';
import { DocumentPreviewModal } from './components/DocumentPreviewModal';
import {
  LetterAuditPayload,
  LettersCertificatesView,
} from './components/LettersCertificatesView';
import { PrintMemoView } from './components/PrintMemoView';
import { RapidEntryView } from './components/RapidEntryView';
import { RecoveryActionSubmission } from './components/RecoveryActionModal';
import {
  ChequeRecoveryPatch,
  ReturnAnalyticsView,
} from './components/ReturnAnalyticsView';
import { ReturnAckView } from './components/ReturnAckView';
import { SettingsView } from './components/SettingsView';
import { SystemAuditLogView } from './components/SystemAuditLogView';
import { deleteDocumentBlob } from './services/documentBlobStore';
import {
  exportFullBackupJson,
  loadTreasuryState,
  parseBackupJsonState,
  ParsedBackupResult,
  resetTreasuryState,
  saveTreasuryState,
} from './services/treasuryStore';
import {
  BankHoliday,
  ChequeEntry,
  ChequeStatus,
  ClearingBatch,
  CompanyBankAccount,
  CompanyWorkspace,
  CorporateProfile,
  CustomerChequeSchedule,
  CustomerDocument,
  CustomerProfile,
  RecoveryPaymentRecord,
  RecoveryStatus,
  ScheduledChequeStatus,
  SystemAuditLogEntry,
  TreasuryState,
  UserRole,
} from './types/treasury';
import {
  getDefaultIndianBankHolidays,
  recalculateScheduleDates,
  toIsoDate,
} from './utils/bankHolidays';
import { getCustomerKey } from './utils/customerHelpers';
import {
  formatIndianDate,
  formatIndianShort,
  formatINR,
  generateBatchRef,
} from './utils/indianCurrency';

type ActiveModule =
  | 'dashboard'
  | 'entry'
  | 'schedules'
  | 'customers'
  | 'memo'
  | 'return-ack'
  | 'letters'
  | 'return-analytics'
  | 'audit-log'
  | 'settings';

function createAuditEntry(
  partial: Omit<SystemAuditLogEntry, 'id' | 'timestamp'> & { timestamp?: string }
): SystemAuditLogEntry {
  return {
    id: `syslog-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: partial.timestamp || new Date().toISOString(),
    ...partial,
  };
}

export default function App() {
  const [state, setState] = useState<TreasuryState>(() => loadTreasuryState());
  const [activeModule, setActiveModule] = useState<ActiveModule>('dashboard');
  const [returnAckScope, setReturnAckScope] = useState<'active' | 'all'>('active');
  const [editingCheque, setEditingCheque] = useState<ChequeEntry | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [showAddCompanyModal, setShowAddCompanyModal] = useState(false);
  const [showBankHolidayDrawer, setShowBankHolidayDrawer] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<UserRole>('Admin');
  const [customerNavSelection, setCustomerNavSelection] =
    useState<CustomerInitialSelection | null>(null);
  const [deepLinkDoc, setDeepLinkDoc] = useState<CustomerDocument | null>(null);
  const headerBackupInputRef = useRef<HTMLInputElement | null>(null);
  const [backupNotice, setBackupNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [pendingRestore, setPendingRestore] = useState<
    (Extract<ParsedBackupResult, { ok: true }> & { fileName: string }) | null
  >(null);

  useEffect(() => {
    saveTreasuryState(state);
  }, [state]);

  // Support secure document share links (?doc=...&company=...&token=...)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const docId = params.get('doc');
    const compId = params.get('company');
    const token = params.get('token');
    if (!docId || !compId) return;
    const targetComp = state.companies.find((c) => c.id === compId);
    const foundDoc = targetComp?.documents?.find(
      (d) => d.id === docId && (!token || d.shareToken === token)
    );
    if (targetComp && foundDoc) {
      setState((prev) =>
        prev.activeCompanyId === targetComp.id
          ? prev
          : { ...prev, activeCompanyId: targetComp.id }
      );
      setCustomerNavSelection({
        customerKey: foundDoc.customerKey,
        tab: 'documents',
      });
      setActiveModule('customers');
      setDeepLinkDoc(foundDoc);
    }
    // Run once on initial mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCompany =
    state.companies.find((c) => c.id === state.activeCompanyId) ||
    state.companies[0];

  const updateActiveCompany = (
    updater: (company: CompanyWorkspace) => CompanyWorkspace
  ) => {
    setState((prev) => ({
      ...prev,
      companies: prev.companies.map((comp) =>
        comp.id === activeCompany.id ? updater(comp) : comp
      ),
    }));
  };

  const activeBatch =
    activeCompany.batches.find((b) => b.id === activeCompany.activeBatchId) ||
    activeCompany.batches[0];

  const activeBatchTotal = activeCompany.cheques
    .filter((c) => c.batchId === activeBatch?.id)
    .reduce((sum, c) => sum + c.amount, 0);

  const handleSwitchCompany = (companyId: string) => {
    setState((prev) => ({ ...prev, activeCompanyId: companyId }));
    setEditingCheque(null);
  };

  const handleCreateCompany = (workspace: CompanyWorkspace) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const initialBatch = workspace.batches[0];
      const newLogs: SystemAuditLogEntry[] = initialBatch
        ? [
            createAuditEntry({
              timestamp: now,
              companyId: workspace.id,
              companyName: workspace.profile.companyName,
              batchId: initialBatch.id,
              batchRef: initialBatch.batchRef,
              actionType: 'BATCH_CREATED',
              actor:
                workspace.profile.defaultMaker ||
                workspace.profile.defaultChecker ||
                'Treasury User',
              description: `Created company workspace "${workspace.profile.companyName}" with initial batch ${initialBatch.batchRef}.`,
              newValue: 'Draft',
            }),
          ]
        : [];
      return {
        ...prev,
        companies: [...prev.companies, workspace],
        activeCompanyId: workspace.id,
        auditLogs: [...newLogs, ...(prev.auditLogs || [])],
      };
    });
    setEditingCheque(null);
    setShowAddCompanyModal(false);
  };

  const handleDeleteCompany = (companyId: string) => {
    setState((prev) => {
      if (prev.companies.length <= 1) return prev;
      const remaining = prev.companies.filter((c) => c.id !== companyId);
      const nextActiveId =
        prev.activeCompanyId === companyId
          ? remaining[0].id
          : prev.activeCompanyId;
      return {
        ...prev,
        companies: remaining,
        activeCompanyId: nextActiveId,
      };
    });
    setEditingCheque(null);
  };

  const handleSelectBatch = (batchId: string) => {
    updateActiveCompany((comp) => ({ ...comp, activeBatchId: batchId }));
  };

  const handleCreateBatch = (depositDate: string, bankAccountId: string) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const nextSeq =
        targetComp.batches.length +
        (targetComp.id === 'comp-bharat-precision' ? 42 : 1);
      const newBatch: ClearingBatch = {
        id: `batch-${Date.now()}`,
        batchRef: generateBatchRef(depositDate, nextSeq),
        depositDate,
        companyBankAccountId: bankAccountId,
        makerName: targetComp.profile.defaultMaker,
        checkerName: targetComp.profile.defaultChecker,
        status: 'Draft',
        isLocked: false,
      };
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: newBatch.id,
        batchRef: newBatch.batchRef,
        actionType: 'BATCH_CREATED',
        actor: targetComp.profile.defaultMaker,
        description: `Created clearing batch ${newBatch.batchRef} scheduled for ${formatIndianDate(depositDate)}.`,
        newValue: 'Draft',
      });
      return {
        ...prev,
        companies: prev.companies.map((c) =>
          c.id === targetComp.id
            ? {
                ...c,
                batches: [newBatch, ...c.batches],
                activeBatchId: newBatch.id,
              }
            : c
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleUpdateBatch = (batchId: string, patch: Partial<ClearingBatch>) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const existingBatch = targetComp.batches.find((b) => b.id === batchId);
      if (!existingBatch) return prev;

      const newLogs: SystemAuditLogEntry[] = [];
      const actor =
        existingBatch.checkerName ||
        targetComp.profile.defaultChecker ||
        'Treasury User';

      if (existingBatch.isLocked) {
        if (!patch.status || patch.status === existingBatch.status) return prev;
        const entry = {
          id: `aud-${Date.now()}`,
          action: 'STATUS_UPDATED' as const,
          actorRole: 'Checker' as const,
          actorName: actor,
          timestamp: now,
          reason: `Status changed to ${patch.status}`,
        };
        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: existingBatch.id,
            batchRef: existingBatch.batchRef,
            actionType: 'BATCH_STATUS_CHANGED',
            actor,
            description: `Updated locked batch ${existingBatch.batchRef} status from ${existingBatch.status || 'Draft'} to ${patch.status}.`,
            oldValue: existingBatch.status || 'Draft',
            newValue: patch.status,
          })
        );
        return {
          ...prev,
          companies: prev.companies.map((c) =>
            c.id !== targetComp.id
              ? c
              : {
                  ...c,
                  batches: c.batches.map((b) =>
                    b.id !== batchId
                      ? b
                      : {
                          ...b,
                          status: patch.status,
                          auditTrail: [entry, ...(b.auditTrail || [])],
                        }
                  ),
                }
          ),
          auditLogs: [...newLogs, ...(prev.auditLogs || [])],
        };
      }

      // Unlocked batch edits
      if (patch.status && patch.status !== existingBatch.status) {
        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: existingBatch.id,
            batchRef: existingBatch.batchRef,
            actionType: 'BATCH_STATUS_CHANGED',
            actor,
            description: `Updated batch ${existingBatch.batchRef} status from ${existingBatch.status || 'Draft'} to ${patch.status}.`,
            oldValue: existingBatch.status || 'Draft',
            newValue: patch.status,
          })
        );
      }

      const changedFields: string[] = [];
      if (patch.depositDate && patch.depositDate !== existingBatch.depositDate) {
        changedFields.push(
          `Deposit Date (${formatIndianDate(existingBatch.depositDate)} → ${formatIndianDate(patch.depositDate)})`
        );
      }
      if (patch.makerName !== undefined && patch.makerName !== existingBatch.makerName) {
        changedFields.push(`Maker (${patch.makerName})`);
      }
      if (patch.checkerName !== undefined && patch.checkerName !== existingBatch.checkerName) {
        changedFields.push(`Checker (${patch.checkerName})`);
      }
      if (patch.notes !== undefined && patch.notes !== existingBatch.notes) {
        changedFields.push('Notes');
      }

      if (changedFields.length > 0) {
        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: existingBatch.id,
            batchRef: existingBatch.batchRef,
            actionType: 'BATCH_EDITED',
            actor: existingBatch.makerName || targetComp.profile.defaultMaker,
            description: `Edited batch ${existingBatch.batchRef}: ${changedFields.join(', ')}.`,
          })
        );
      }

      return {
        ...prev,
        companies: prev.companies.map((c) =>
          c.id !== targetComp.id
            ? c
            : {
                ...c,
                batches: c.batches.map((b) =>
                  b.id === batchId ? { ...b, ...patch } : b
                ),
              }
        ),
        auditLogs:
          newLogs.length > 0
            ? [...newLogs, ...(prev.auditLogs || [])]
            : prev.auditLogs,
      };
    });
  };

  const handleLockBatch = (
    batchId: string,
    password: string,
    actorName: string
  ) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const existingBatch = targetComp.batches.find((b) => b.id === batchId);
      if (!existingBatch) return prev;

      const entry = {
        id: `aud-${Date.now()}`,
        action: 'LOCKED' as const,
        actorRole: 'Checker' as const,
        actorName,
        timestamp: now,
      };
      const sysLog = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: existingBatch.id,
        batchRef: existingBatch.batchRef,
        actionType: 'BATCH_LOCKED',
        actor: `${actorName} (Checker)`,
        description: `Locked batch ${existingBatch.batchRef} for print integrity.`,
        oldValue: 'Unlocked',
        newValue: 'Locked',
      });

      return {
        ...prev,
        companies: prev.companies.map((c) =>
          c.id !== targetComp.id
            ? c
            : {
                ...c,
                batches: c.batches.map((b) =>
                  b.id !== batchId
                    ? b
                    : {
                        ...b,
                        isLocked: true,
                        lockedAt: now,
                        lockedBy: actorName,
                        lockPassword: password,
                        auditTrail: [entry, ...(b.auditTrail || [])],
                      }
                ),
              }
        ),
        auditLogs: [sysLog, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleUnlockBatch = (
    batchId: string,
    actorRole: 'Maker' | 'Checker',
    actorName: string,
    reason: string
  ) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const existingBatch = targetComp.batches.find((b) => b.id === batchId);
      if (!existingBatch) return prev;

      const entry = {
        id: `aud-${Date.now()}`,
        action: 'UNLOCKED_BYPASS' as const,
        actorRole,
        actorName,
        timestamp: now,
        reason,
      };
      const sysLog = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: existingBatch.id,
        batchRef: existingBatch.batchRef,
        actionType: 'BATCH_UNLOCKED',
        actor: `${actorName} (${actorRole})`,
        description: `Unlocked batch ${existingBatch.batchRef} via password bypass. Reason: ${reason}`,
        oldValue: 'Locked',
        newValue: 'Unlocked',
      });

      return {
        ...prev,
        companies: prev.companies.map((c) =>
          c.id !== targetComp.id
            ? c
            : {
                ...c,
                batches: c.batches.map((b) =>
                  b.id !== batchId
                    ? b
                    : {
                        ...b,
                        isLocked: false,
                        lockedAt: undefined,
                        auditTrail: [entry, ...(b.auditTrail || [])],
                      }
                ),
              }
        ),
        auditLogs: [sysLog, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleSaveCheque = (
    payload: Omit<ChequeEntry, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const targetBatch = targetComp.batches.find((b) => b.id === payload.batchId);
      const actor =
        targetBatch?.makerName || targetComp.profile.defaultMaker || 'Treasury User';

      if (targetBatch?.isLocked) {
        if (!existingId) return prev;
        const oldCheque = targetComp.cheques.find((c) => c.id === existingId);
        if (!oldCheque) return prev;

        const newLogs: SystemAuditLogEntry[] = [];
        if (oldCheque.status !== payload.status) {
          newLogs.push(
            createAuditEntry({
              timestamp: now,
              companyId: targetComp.id,
              companyName: targetComp.profile.companyName,
              batchId: targetBatch.id,
              batchRef: targetBatch.batchRef,
              chequeId: oldCheque.id,
              chequeNumber: oldCheque.chequeNumber,
              actionType: 'CHEQUE_STATUS_CHANGED',
              actor,
              description: `Cheque #${oldCheque.chequeNumber} (${oldCheque.partyName}) status changed on locked batch: ${oldCheque.status} → ${payload.status}.`,
              oldValue: oldCheque.status,
              newValue: payload.status,
            })
          );
        }

        return {
          ...prev,
          companies: prev.companies.map((comp) =>
            comp.id !== targetComp.id
              ? comp
              : {
                  ...comp,
                  cheques: comp.cheques.map((c) => {
                    if (c.id !== existingId) return c;
                    return {
                      ...c,
                      status: payload.status,
                      clearedDate:
                        payload.status === 'Cleared'
                          ? payload.clearedDate || now.slice(0, 10)
                          : c.clearedDate,
                      bouncedDate:
                        payload.status === 'Returned / Bounced'
                          ? payload.bouncedDate || now.slice(0, 10)
                          : c.bouncedDate,
                      bounceReason:
                        payload.status === 'Returned / Bounced'
                          ? payload.bounceReason ?? c.bounceReason
                          : c.bounceReason,
                      penaltyAmount:
                        payload.status === 'Returned / Bounced'
                          ? payload.penaltyAmount ?? c.penaltyAmount
                          : c.penaltyAmount,
                      updatedAt: now,
                    };
                  }),
                }
          ),
          auditLogs:
            newLogs.length > 0
              ? [...newLogs, ...(prev.auditLogs || [])]
              : prev.auditLogs,
        };
      }

      if (existingId) {
        const oldCheque = targetComp.cheques.find((c) => c.id === existingId);
        if (!oldCheque) return prev;
        const newLogs: SystemAuditLogEntry[] = [];

        if (oldCheque.status !== payload.status) {
          newLogs.push(
            createAuditEntry({
              timestamp: now,
              companyId: targetComp.id,
              companyName: targetComp.profile.companyName,
              batchId: targetBatch?.id,
              batchRef: targetBatch?.batchRef,
              chequeId: oldCheque.id,
              chequeNumber: payload.chequeNumber,
              actionType: 'CHEQUE_STATUS_CHANGED',
              actor,
              description: `Cheque #${payload.chequeNumber} (${payload.partyName}) status changed: ${oldCheque.status} → ${payload.status}.`,
              oldValue: oldCheque.status,
              newValue: payload.status,
            })
          );
        }

        const fieldChanges: string[] = [];
        if (oldCheque.amount !== payload.amount) {
          fieldChanges.push(
            `Amount (${formatINR(oldCheque.amount)} → ${formatINR(payload.amount)})`
          );
        }
        if (oldCheque.chequeNumber !== payload.chequeNumber) {
          fieldChanges.push(
            `Cheque No (#${oldCheque.chequeNumber} → #${payload.chequeNumber})`
          );
        }
        if (oldCheque.partyName !== payload.partyName) {
          fieldChanges.push(`Party (${payload.partyName})`);
        }
        if (oldCheque.chequeDate !== payload.chequeDate) {
          fieldChanges.push(`Date (${formatIndianDate(payload.chequeDate)})`);
        }
        if (oldCheque.draweeBank !== payload.draweeBank) {
          fieldChanges.push(`Drawee Bank (${payload.draweeBank})`);
        }

        if (fieldChanges.length > 0 || newLogs.length === 0) {
          newLogs.push(
            createAuditEntry({
              timestamp: now,
              companyId: targetComp.id,
              companyName: targetComp.profile.companyName,
              batchId: targetBatch?.id,
              batchRef: targetBatch?.batchRef,
              chequeId: oldCheque.id,
              chequeNumber: payload.chequeNumber,
              actionType: 'CHEQUE_EDITED',
              actor,
              description:
                fieldChanges.length > 0
                  ? `Edited cheque #${payload.chequeNumber} (${payload.partyName}): ${fieldChanges.join(', ')}.`
                  : `Updated cheque #${payload.chequeNumber} (${payload.partyName}) details.`,
            })
          );
        }

        return {
          ...prev,
          companies: prev.companies.map((comp) =>
            comp.id !== targetComp.id
              ? comp
              : {
                  ...comp,
                  cheques: comp.cheques.map((c) =>
                    c.id === existingId ? { ...c, ...payload, updatedAt: now } : c
                  ),
                }
          ),
          auditLogs: [...newLogs, ...(prev.auditLogs || [])],
        };
      } else {
        const newCheque: ChequeEntry = {
          ...payload,
          id: `chq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          createdAt: now,
          updatedAt: now,
        };
        const log = createAuditEntry({
          timestamp: now,
          companyId: targetComp.id,
          companyName: targetComp.profile.companyName,
          batchId: targetBatch?.id,
          batchRef: targetBatch?.batchRef,
          chequeId: newCheque.id,
          chequeNumber: newCheque.chequeNumber,
          actionType: 'CHEQUE_ADDED',
          actor,
          description: `Added cheque #${newCheque.chequeNumber} (${newCheque.partyName}, ${formatINR(newCheque.amount)}) to batch ${targetBatch?.batchRef || ''}.`,
          newValue: newCheque.status,
        });
        return {
          ...prev,
          companies: prev.companies.map((comp) =>
            comp.id !== targetComp.id
              ? comp
              : {
                  ...comp,
                  cheques: [...comp.cheques, newCheque],
                }
          ),
          auditLogs: [log, ...(prev.auditLogs || [])],
        };
      }
    });
  };

  const handleUpdateChequeStatus = (
    chequeIds: string[],
    status: ChequeStatus,
    bounceData?: {
      bounceReason: string;
      penaltyAmount: number;
      bouncedDate: string;
      remarks: string;
    }
  ) => {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const batchMap = new Map(targetComp.batches.map((b) => [b.id, b]));
      const actor =
        targetComp.profile.defaultChecker ||
        targetComp.profile.defaultMaker ||
        'Treasury User';
      const newLogs: SystemAuditLogEntry[] = [];

      const nextCheques = targetComp.cheques.map((c) => {
        if (!chequeIds.includes(c.id)) return c;
        const b = batchMap.get(c.batchId);
        const reasonText =
          status === 'Returned / Bounced' && bounceData?.bounceReason
            ? ` (${bounceData.bounceReason})`
            : '';

        if (c.status !== status || (status === 'Returned / Bounced' && bounceData)) {
          newLogs.push(
            createAuditEntry({
              timestamp: now,
              companyId: targetComp.id,
              companyName: targetComp.profile.companyName,
              batchId: c.batchId,
              batchRef: b?.batchRef,
              chequeId: c.id,
              chequeNumber: c.chequeNumber,
              actionType: 'CHEQUE_STATUS_CHANGED',
              actor,
              description: `Cheque #${c.chequeNumber} (${c.partyName}, ${formatINR(c.amount)}) status changed: ${c.status} → ${status}${reasonText}.`,
              oldValue: c.status,
              newValue: status,
            })
          );
        }

        if (status === 'Returned / Bounced' && bounceData) {
          return {
            ...c,
            status,
            bounceReason: bounceData.bounceReason,
            penaltyAmount: bounceData.penaltyAmount,
            bouncedDate: bounceData.bouncedDate,
            remarks: bounceData.remarks || c.remarks,
            updatedAt: now,
          };
        }
        return {
          ...c,
          status,
          clearedDate: status === 'Cleared' ? today : c.clearedDate,
          updatedAt: now,
        };
      });

      const linkedStatus: ScheduledChequeStatus | null =
        status === 'Cleared'
          ? 'Cleared'
          : status === 'Returned / Bounced'
          ? 'Returned / Bounced'
          : status === 'Draft' ||
            status === 'Submitted to Bank' ||
            status === 'Re-Deposited'
          ? 'In Clearing'
          : null;

      const updatedIdSet = new Set(chequeIds);
      const nextChequeSchedules = linkedStatus
        ? (targetComp.chequeSchedules || []).map((sch) => ({
            ...sch,
            cheques: (sch.cheques || []).map((item) =>
              item.clearingChequeId && updatedIdSet.has(item.clearingChequeId)
                ? { ...item, status: linkedStatus }
                : item
            ),
          }))
        : targetComp.chequeSchedules;

      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id === targetComp.id
            ? {
                ...comp,
                cheques: nextCheques,
                chequeSchedules: nextChequeSchedules,
              }
            : comp
        ),
        auditLogs:
          newLogs.length > 0
            ? [...newLogs, ...(prev.auditLogs || [])]
            : prev.auditLogs,
      };
    });
  };

  const handleReconcileReturnedCheques = (
    updates: ReconcileConfirmItem[],
    fileName: string
  ) => {
    if (updates.length === 0) return;
    const now = new Date().toISOString();
    const today = now.slice(0, 10);
    const updateMap = new Map(updates.map((u) => [u.chequeId, u]));

    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const batchMap = new Map(targetComp.batches.map((b) => [b.id, b]));
      const actor = targetComp.profile.defaultChecker || 'Treasury System';
      const affectedBatchStats = new Map<
        string,
        { cleared: number; returned: number }
      >();
      const newLogs: SystemAuditLogEntry[] = [];
      const reconciledStatusByChequeId = new Map<
        string,
        'Cleared' | 'Returned / Bounced'
      >();
      let totalCleared = 0;
      let totalReturned = 0;

      const nextCheques = targetComp.cheques.map((c) => {
        const match = updateMap.get(c.id);
        if (!match) return c;

        const targetStatus: ChequeStatus =
          match.matchType === 'CLEARED' || match.targetStatus === 'Cleared'
            ? 'Cleared'
            : 'Returned / Bounced';

        // Never overwrite an already Returned or Settled cheque with Cleared
        if (
          targetStatus === 'Cleared' &&
          (c.status === 'Returned / Bounced' ||
            c.status === 'Settled / Recovered')
        ) {
          return c;
        }

        const stats = affectedBatchStats.get(c.batchId) || {
          cleared: 0,
          returned: 0,
        };
        const batchRef = batchMap.get(c.batchId)?.batchRef;

        if (targetStatus === 'Cleared') {
          stats.cleared += 1;
          affectedBatchStats.set(c.batchId, stats);
          totalCleared += 1;
          const clearedDate = match.clearedDate || today;

          newLogs.push(
            createAuditEntry({
              timestamp: now,
              companyId: targetComp.id,
              companyName: targetComp.profile.companyName,
              batchId: c.batchId,
              batchRef,
              chequeId: c.id,
              chequeNumber: c.chequeNumber,
              actionType: 'CHEQUE_STATUS_CHANGED',
              actor: `${actor} (Auto-Reconciliation)`,
              description: `Auto-updated cheque #${c.chequeNumber} (${c.partyName}) via statement "${fileName}": ${c.status} → Cleared (${clearedDate}).`,
              oldValue: c.status,
              newValue: 'Cleared',
            })
          );

          reconciledStatusByChequeId.set(c.id, 'Cleared');

          return {
            ...c,
            status: 'Cleared' as ChequeStatus,
            clearedDate,
            updatedAt: now,
          };
        }

        stats.returned += 1;
        affectedBatchStats.set(c.batchId, stats);
        totalReturned += 1;
        const reason = match.returnReason.trim() || 'Returned by Bank';

        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: c.batchId,
            batchRef,
            chequeId: c.id,
            chequeNumber: c.chequeNumber,
            actionType: 'CHEQUE_STATUS_CHANGED',
            actor: `${actor} (Auto-Reconciliation)`,
            description: `Auto-updated cheque #${c.chequeNumber} (${c.partyName}) via statement "${fileName}": ${c.status} → Returned / Bounced (${reason}).`,
            oldValue: c.status,
            newValue: 'Returned / Bounced',
          })
        );

        reconciledStatusByChequeId.set(c.id, 'Returned / Bounced');

        return {
          ...c,
          status: 'Returned / Bounced' as ChequeStatus,
          bounceReason: reason,
          bouncedDate: match.bouncedDate || today,
          updatedAt: now,
        };
      });

      const nextBatches = targetComp.batches.map((b) => {
        const stats = affectedBatchStats.get(b.id);
        if (!stats || (stats.cleared === 0 && stats.returned === 0)) return b;
        const parts: string[] = [];
        if (stats.cleared > 0) {
          parts.push(
            `${stats.cleared} cheque${stats.cleared === 1 ? '' : 's'} marked Cleared`
          );
        }
        if (stats.returned > 0) {
          parts.push(
            `${stats.returned} cheque${stats.returned === 1 ? '' : 's'} marked Returned`
          );
        }
        const entry = {
          id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          action: 'STATUS_UPDATED' as const,
          actorRole: 'Checker' as const,
          actorName: actor,
          timestamp: now,
          reason: `Bank statement reconciliation (${fileName}): ${parts.join(', ')}`,
        };
        return {
          ...b,
          auditTrail: [entry, ...(b.auditTrail || [])],
        };
      });

      // Summary Bank Statement Upload log entry
      const batchRefsList = Array.from(affectedBatchStats.keys())
        .map((bid) => batchMap.get(bid)?.batchRef)
        .filter(Boolean)
        .join(', ');

      const summaryParts: string[] = [];
      if (totalCleared > 0) {
        summaryParts.push(
          `${totalCleared} cheque${totalCleared === 1 ? '' : 's'} marked Cleared`
        );
      }
      if (totalReturned > 0) {
        summaryParts.push(
          `${totalReturned} cheque${totalReturned === 1 ? '' : 's'} marked Returned`
        );
      }

      const uploadSummaryLog = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId:
          affectedBatchStats.size === 1
            ? Array.from(affectedBatchStats.keys())[0]
            : undefined,
        batchRef: batchRefsList || undefined,
        actionType: 'BANK_STATEMENT_UPLOADED',
        actor,
        description: `Uploaded bank statement "${fileName}": ${
          summaryParts.length > 0
            ? summaryParts.join(', ')
            : '0 status changes applied'
        }.`,
        metadata: {
          fileName,
          updatedCount: totalCleared + totalReturned,
          clearedCount: totalCleared,
          returnedCount: totalReturned,
        },
      });

      const nextChequeSchedules =
        reconciledStatusByChequeId.size > 0
          ? (targetComp.chequeSchedules || []).map((sch) => ({
              ...sch,
              cheques: (sch.cheques || []).map((item) => {
                const synced = item.clearingChequeId
                  ? reconciledStatusByChequeId.get(item.clearingChequeId)
                  : undefined;
                return synced ? { ...item, status: synced } : item;
              }),
            }))
          : targetComp.chequeSchedules;

      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id === targetComp.id
            ? {
                ...comp,
                cheques: nextCheques,
                batches: nextBatches,
                chequeSchedules: nextChequeSchedules,
              }
            : comp
        ),
        auditLogs: [uploadSummaryLog, ...newLogs, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleDeleteCheque = (chequeId: string) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const target = targetComp.cheques.find((c) => c.id === chequeId);
      if (!target) return prev;
      const batch = targetComp.batches.find((b) => b.id === target.batchId);
      if (batch?.isLocked) return prev;

      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: batch?.id,
        batchRef: batch?.batchRef,
        chequeId: target.id,
        chequeNumber: target.chequeNumber,
        actionType: 'CHEQUE_DELETED',
        actor: batch?.makerName || targetComp.profile.defaultMaker,
        description: `Deleted cheque #${target.chequeNumber} (${target.partyName}, ${formatINR(target.amount)}) from batch ${batch?.batchRef || ''}.`,
        oldValue: target.status,
      });

      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                cheques: comp.cheques.filter((c) => c.id !== chequeId),
                chequeSchedules: (comp.chequeSchedules || []).map((sch) => ({
                  ...sch,
                  cheques: (sch.cheques || []).map((item) =>
                    item.clearingChequeId === chequeId
                      ? {
                          ...item,
                          status: 'Scheduled' as ScheduledChequeStatus,
                          clearingBatchId: undefined,
                          clearingBatchRef: undefined,
                          clearingChequeId: undefined,
                          sentToClearingAt: undefined,
                        }
                      : item
                  ),
                })),
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
    if (editingCheque?.id === chequeId) {
      setEditingCheque(null);
    }
  };

  const handleEditCheque = (cheque: ChequeEntry) => {
    setEditingCheque(cheque);
    setActiveModule('entry');
  };

  const handleUpdateReturnReason = (chequeId: string, reason: string) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const target = targetComp.cheques.find((c) => c.id === chequeId);
      if (!target) return prev;
      const batch = targetComp.batches.find((b) => b.id === target.batchId);

      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: batch?.id,
        batchRef: batch?.batchRef,
        chequeId: target.id,
        chequeNumber: target.chequeNumber,
        actionType: 'CHEQUE_EDITED',
        actor: targetComp.profile.defaultChecker || 'Treasury Desk',
        description: `Updated Return Reason on cheque #${target.chequeNumber} (${target.partyName}).`,
        oldValue: target.bounceReason || 'Unspecified',
        newValue: reason,
      });

      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                cheques: comp.cheques.map((c) =>
                  c.id === chequeId
                    ? { ...c, bounceReason: reason, updatedAt: now }
                    : c
                ),
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleLogReturnAck = (details: {
    kind: 'PDF_DOWNLOADED' | 'PRINTED';
    chequeIds: string[];
    bankNames: string;
    batchId?: string;
    batchRef?: string;
  }) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const actionLabel =
        details.kind === 'PDF_DOWNLOADED'
          ? 'Downloaded A4 PDF'
          : 'Sent to Printer';
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: details.batchId,
        batchRef: details.batchRef,
        actionType: 'RETURN_ACK_GENERATED',
        actor: targetComp.profile.defaultMaker || 'Treasury Executive',
        description: `${actionLabel} Return Cheque Acknowledgement Letter for ${details.chequeIds.length} returned cheque${
          details.chequeIds.length === 1 ? '' : 's'
        } (${details.bankNames}).`,
        metadata: {
          chequeCount: details.chequeIds.length,
          mode: details.kind,
        },
      });
      return {
        ...prev,
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleLogLetterGenerated = (details: LetterAuditPayload) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const actionLabel =
        details.actionMode === 'PDF_DOWNLOADED' ? 'Downloaded PDF' : 'Printed';
      const isNoc = details.letterType === 'NOC';
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        customerName: isNoc ? details.subjectPartyOrBank : undefined,
        documentTitle: `${isNoc ? 'NOC' : 'DD Cancellation'} (${details.refNo})`,
        actionType: isNoc
          ? 'NOC_LETTER_GENERATED'
          : 'DD_CANCELLATION_GENERATED',
        actor:
          currentUserRole === 'Admin'
            ? `${targetComp.profile.defaultChecker || 'Treasury Admin'} (Admin)`
            : `${targetComp.profile.defaultMaker || 'Treasury Executive'} (Maker)`,
        description: `${actionLabel} ${
          isNoc
            ? `No Objection Certificate for ${details.subjectPartyOrBank}`
            : `Bank DD Cancellation Letter to ${details.subjectPartyOrBank}`
        }${
          details.instrumentOrAccountRef
            ? ` (${isNoc ? 'A/c' : 'DD #'}: ${details.instrumentOrAccountRef})`
            : ''
        } for ${formatINR(details.amount)} [Ref: ${details.refNo}].`,
        newValue: `${formatINR(details.amount)} · ${details.refNo}`,
      });
      return {
        ...prev,
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleUpdateChequeRecovery = (
    companyId: string,
    chequeId: string,
    patch: ChequeRecoveryPatch
  ) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp = prev.companies.find((c) => c.id === companyId);
      if (!targetComp) return prev;
      const oldCheque = targetComp.cheques.find((c) => c.id === chequeId);
      if (!oldCheque) return prev;
      const batch = targetComp.batches.find((b) => b.id === oldCheque.batchId);

      const notes: string[] = [];
      if (
        patch.bankCollectionStatus &&
        patch.bankCollectionStatus !==
          (oldCheque.bankCollectionStatus || 'Pending Collection')
      ) {
        notes.push(
          `Bank Collection: ${oldCheque.bankCollectionStatus || 'Pending Collection'} → ${patch.bankCollectionStatus}`
        );
      }
      if (
        patch.recoveredAmount !== undefined &&
        patch.recoveredAmount !== (oldCheque.recoveredAmount ?? 0)
      ) {
        notes.push(
          `Recovered Amount: ${formatINR(oldCheque.recoveredAmount ?? 0)} → ${formatINR(patch.recoveredAmount)}${
            patch.recoveryMode ? ` via ${patch.recoveryMode}` : ''
          }${patch.recoveryRef ? ` (${patch.recoveryRef})` : ''}`
        );
      } else if (patch.recoveryRef && patch.recoveryRef !== oldCheque.recoveryRef) {
        notes.push(`Ref: ${patch.recoveryRef}`);
      }

      const sysLog = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: batch?.id,
        batchRef: batch?.batchRef,
        chequeId: oldCheque.id,
        chequeNumber: oldCheque.chequeNumber,
        actionType: 'RECOVERY_UPDATED',
        actor: targetComp.profile.defaultMaker || 'Treasury Executive',
        description:
          notes.length > 0
            ? `Updated collection/recovery for cheque #${oldCheque.chequeNumber} (${oldCheque.partyName}): ${notes.join('; ')}.`
            : `Updated recovery details for cheque #${oldCheque.chequeNumber} (${oldCheque.partyName}).`,
        oldValue:
          oldCheque.recoveryStatus ||
          oldCheque.bankCollectionStatus ||
          'Unrecovered',
        newValue:
          patch.recoveryStatus ||
          patch.bankCollectionStatus ||
          oldCheque.recoveryStatus,
      });

      return {
        ...prev,
        companies: prev.companies.map((comp) => {
          if (comp.id !== companyId) return comp;
          return {
            ...comp,
            cheques: comp.cheques.map((c) =>
              c.id === chequeId ? { ...c, ...patch, updatedAt: now } : c
            ),
          };
        }),
        auditLogs: [sysLog, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleExecuteRecoveryAction = (
    companyId: string,
    chequeId: string,
    submission: RecoveryActionSubmission
  ) => {
    const now = new Date().toISOString();
    const today = now.slice(0, 10);

    setState((prev) => {
      const targetComp = prev.companies.find((c) => c.id === companyId);
      if (!targetComp) return prev;
      const oldCheque = targetComp.cheques.find((c) => c.id === chequeId);
      if (!oldCheque) return prev;
      const sourceBatch = targetComp.batches.find(
        (b) => b.id === oldCheque.batchId
      );
      const actor =
        targetComp.profile.defaultMaker ||
        targetComp.profile.defaultChecker ||
        'Treasury Executive';

      const newLogs: SystemAuditLogEntry[] = [];
      let nextBatches = targetComp.batches;
      let nextCheques = targetComp.cheques;
      let nextActiveBatchId = targetComp.activeBatchId;

      const resolveOrCreateBatch = (
        batchMode: 'existing' | 'new',
        targetBatchId?: string,
        depositDate?: string,
        bankAccountId?: string
      ): ClearingBatch => {
        if (batchMode === 'existing' && targetBatchId) {
          const found = nextBatches.find((b) => b.id === targetBatchId);
          if (found) return found;
        }
        const depDate = depositDate || today;
        const seq =
          nextBatches.length +
          (targetComp.id === 'comp-bharat-precision' ? 42 : 1);
        const createdBatch: ClearingBatch = {
          id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          batchRef: generateBatchRef(depDate, seq),
          depositDate: depDate,
          companyBankAccountId:
            bankAccountId ||
            oldCheque.companyBankAccountId ||
            targetComp.bankAccounts[0]?.id ||
            '',
          makerName: targetComp.profile.defaultMaker,
          checkerName: targetComp.profile.defaultChecker,
          status: 'Draft',
          isLocked: false,
        };
        nextBatches = [createdBatch, ...nextBatches];
        nextActiveBatchId = createdBatch.id;
        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: createdBatch.id,
            batchRef: createdBatch.batchRef,
            actionType: 'BATCH_CREATED',
            actor,
            description: `Created deposit batch ${createdBatch.batchRef} (${formatIndianDate(depDate)}) during returned cheque recovery/re-deposit.`,
            newValue: 'Draft',
          })
        );
        return createdBatch;
      };

      const buildUpdatedPayments = (
        newRecord: RecoveryPaymentRecord
      ): RecoveryPaymentRecord[] => {
        const existing = oldCheque.recoveryPayments || [];
        if (
          existing.length === 0 &&
          (oldCheque.recoveredAmount ?? 0) > 0
        ) {
          const legacyRec: RecoveryPaymentRecord = {
            id: `pay-legacy-${Date.now()}`,
            mode:
              oldCheque.recoveryMode === 'Cash'
                ? 'Cash'
                : oldCheque.recoveryMode === 'Replacement Cheque'
                ? 'Replacement Cheque'
                : 'NEFT / RTGS / UPI',
            refNumber: oldCheque.recoveryRef || 'Prior Payment',
            paymentDate: oldCheque.recoveryDate || today,
            amount: oldCheque.recoveredAmount ?? 0,
            bounceChargesCollected: oldCheque.bounceChargesCollected,
            recordedAt: oldCheque.updatedAt || now,
          };
          return [legacyRec, newRecord];
        }
        return [...existing, newRecord];
      };

      if (
        submission.choice === 'NEFT_RTGS_UPI' ||
        submission.choice === 'CASH'
      ) {
        const modeLabel =
          submission.choice === 'CASH' ? 'Cash' : 'NEFT / RTGS / UPI';
        const payRecord: RecoveryPaymentRecord = {
          id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          mode: modeLabel,
          refNumber: submission.refNumber,
          paymentDate: submission.paymentDate,
          amount: submission.receivedAmount,
          bounceChargesCollected:
            submission.bounceChargesCollected > 0
              ? submission.bounceChargesCollected
              : undefined,
          remarks: submission.remarks,
          recordedAt: now,
        };
        const updatedPayments = buildUpdatedPayments(payRecord);
        const totalPaid = Math.min(
          oldCheque.amount,
          updatedPayments.reduce((s, p) => s + p.amount, 0)
        );
        const remainingBal = Math.max(0, oldCheque.amount - totalPaid);
        const totalCharges =
          (oldCheque.bounceChargesCollected ?? 0) +
          submission.bounceChargesCollected;
        const recoveryStatus: RecoveryStatus =
          remainingBal === 0
            ? 'Recovered / Settled'
            : totalPaid > 0
            ? 'Partially Recovered'
            : 'Unrecovered';

        nextCheques = nextCheques.map((c) =>
          c.id !== chequeId
            ? c
            : {
                ...c,
                status: 'Settled / Recovered' as ChequeStatus,
                recoveryStatus,
                recoveredAmount: totalPaid,
                recoveryDate: submission.paymentDate,
                recoveryMode: modeLabel,
                recoveryRef: submission.refNumber,
                recoveryPayments: updatedPayments,
                bounceChargesCollected:
                  totalCharges > 0 ? totalCharges : c.bounceChargesCollected,
                bankCollectionStatus:
                  submission.bankCollectionStatus ||
                  c.bankCollectionStatus ||
                  'Collected from Bank',
                collectedFromBankDate:
                  (submission.bankCollectionStatus || c.bankCollectionStatus) ===
                  'Collected from Bank'
                    ? c.collectedFromBankDate || submission.paymentDate
                    : c.collectedFromBankDate,
                remarks: submission.remarks || c.remarks,
                updatedAt: now,
              }
        );

        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: sourceBatch?.id,
            batchRef: sourceBatch?.batchRef,
            chequeId: oldCheque.id,
            chequeNumber: oldCheque.chequeNumber,
            actionType: 'RECOVERY_UPDATED',
            actor,
            description: `Recorded ${modeLabel} recovery of ${formatINR(submission.receivedAmount)} (Ref: ${submission.refNumber}) on cheque #${oldCheque.chequeNumber} (${oldCheque.partyName}). Paid: ${formatINR(totalPaid)} / Balance: ${formatINR(remainingBal)}${
              submission.bounceChargesCollected > 0
                ? `; Bounce Charges Collected: ${formatINR(submission.bounceChargesCollected)}`
                : ''
            }.`,
            oldValue: oldCheque.status,
            newValue:
              remainingBal === 0
                ? 'Settled / Recovered'
                : `Settled / Recovered (Partial · Bal ${formatINR(remainingBal)})`,
          })
        );
      } else if (submission.choice === 'REPLACEMENT_CHEQUE') {
        let linkedBatch: ClearingBatch | undefined;
        let createdRepCheque: ChequeEntry | undefined;

        if (submission.batchMode !== 'none') {
          linkedBatch = resolveOrCreateBatch(
            submission.batchMode,
            submission.targetBatchId,
            submission.newBatchDepositDate,
            submission.newBatchBankAccountId
          );
          createdRepCheque = {
            id: `chq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            batchId: linkedBatch.id,
            companyBankAccountId:
              linkedBatch.companyBankAccountId ||
              oldCheque.companyBankAccountId,
            chequeDate: submission.newChequeDate,
            chequeNumber: submission.newChequeNumber,
            micrCode: oldCheque.micrCode,
            draweeBank: submission.bankName,
            draweeBranch: submission.branchName,
            clearingType: oldCheque.clearingType,
            partyName: oldCheque.partyName,
            customerCode: oldCheque.customerCode,
            invoiceRef: oldCheque.invoiceRef,
            amount: submission.amount,
            status: 'Draft',
            presentationCount: 1,
            replacesChequeId: oldCheque.id,
            replacesChequeNumber: oldCheque.chequeNumber,
            remarks:
              submission.remarks ||
              `Replacement cheque for bounced Chq #${oldCheque.chequeNumber}`,
            createdAt: now,
            updatedAt: now,
          };
          nextCheques = [...nextCheques, createdRepCheque];
          newLogs.push(
            createAuditEntry({
              timestamp: now,
              companyId: targetComp.id,
              companyName: targetComp.profile.companyName,
              batchId: linkedBatch.id,
              batchRef: linkedBatch.batchRef,
              chequeId: createdRepCheque.id,
              chequeNumber: createdRepCheque.chequeNumber,
              actionType: 'CHEQUE_ADDED',
              actor,
              description: `Added replacement cheque #${createdRepCheque.chequeNumber} (${submission.bankName}, ${formatINR(submission.amount)}) to batch ${linkedBatch.batchRef} replacing bounced #${oldCheque.chequeNumber}.`,
              newValue: 'Draft',
            })
          );
        }

        const payRecord: RecoveryPaymentRecord = {
          id: `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          mode: 'Replacement Cheque',
          refNumber: `Chq #${submission.newChequeNumber} (${submission.bankName})`,
          paymentDate: submission.newChequeDate,
          amount: submission.amount,
          bounceChargesCollected:
            submission.bounceChargesCollected > 0
              ? submission.bounceChargesCollected
              : undefined,
          remarks: submission.remarks,
          recordedAt: now,
        };
        const updatedPayments = buildUpdatedPayments(payRecord);
        const totalPaid = Math.min(
          oldCheque.amount,
          updatedPayments.reduce((s, p) => s + p.amount, 0)
        );
        const remainingBal = Math.max(0, oldCheque.amount - totalPaid);
        const totalCharges =
          (oldCheque.bounceChargesCollected ?? 0) +
          submission.bounceChargesCollected;
        const recoveryStatus: RecoveryStatus =
          remainingBal === 0 ? 'Recovered / Settled' : 'Partially Recovered';

        nextCheques = nextCheques.map((c) =>
          c.id !== chequeId
            ? c
            : {
                ...c,
                status: 'Settled / Recovered' as ChequeStatus,
                recoveryStatus,
                recoveredAmount: totalPaid,
                recoveryDate: submission.newChequeDate,
                recoveryMode: 'Replacement Cheque',
                recoveryRef: `#${submission.newChequeNumber}`,
                recoveryPayments: updatedPayments,
                bounceChargesCollected:
                  totalCharges > 0 ? totalCharges : c.bounceChargesCollected,
                replacementChequeNumber: submission.newChequeNumber,
                replacementChequeDate: submission.newChequeDate,
                replacementBankName: submission.bankName,
                replacementChequeId: createdRepCheque?.id,
                bankCollectionStatus: 'Collected from Bank',
                collectedFromBankDate: c.collectedFromBankDate || today,
                remarks: submission.remarks || c.remarks,
                updatedAt: now,
              }
        );

        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: sourceBatch?.id,
            batchRef: sourceBatch?.batchRef,
            chequeId: oldCheque.id,
            chequeNumber: oldCheque.chequeNumber,
            actionType: 'RECOVERY_UPDATED',
            actor,
            description: `Replaced bounced cheque #${oldCheque.chequeNumber} (${oldCheque.partyName}) with new cheque #${submission.newChequeNumber} (${submission.bankName}, ${formatINR(submission.amount)})${
              linkedBatch ? ` in batch ${linkedBatch.batchRef}` : ''
            }.`,
            oldValue: oldCheque.status,
            newValue: 'Settled / Recovered',
          })
        );
      } else if (submission.choice === 'RE_PRESENT') {
        // RE_PRESENT: 1-click Move to Re-Deposit
        const targetBatch = resolveOrCreateBatch(
          submission.batchMode,
          submission.targetBatchId,
          submission.newBatchDepositDate,
          submission.newBatchBankAccountId
        );
        const nextPresCount = (oldCheque.presentationCount || 1) + 1;
        const presSuffix =
          nextPresCount === 2 ? 'nd' : nextPresCount === 3 ? 'rd' : 'th';
        const clonedCheque: ChequeEntry = {
          id: `chq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          batchId: targetBatch.id,
          companyBankAccountId:
            targetBatch.companyBankAccountId || oldCheque.companyBankAccountId,
          chequeDate: oldCheque.chequeDate,
          chequeNumber: oldCheque.chequeNumber,
          micrCode: oldCheque.micrCode,
          draweeBank: oldCheque.draweeBank,
          draweeBranch: oldCheque.draweeBranch,
          clearingType: oldCheque.clearingType,
          partyName: oldCheque.partyName,
          customerCode: oldCheque.customerCode,
          invoiceRef: oldCheque.invoiceRef,
          amount: oldCheque.amount,
          status: 'Draft',
          presentationCount: nextPresCount,
          reDepositedFromChequeId: oldCheque.id,
          remarks:
            submission.remarks ||
            `${nextPresCount}${presSuffix} Presentation (Re-deposited from ${sourceBatch?.batchRef || 'prior batch'})`,
          createdAt: now,
          updatedAt: now,
        };

        nextCheques = nextCheques
          .map((c) =>
            c.id !== chequeId
              ? c
              : {
                  ...c,
                  status: 'Re-Deposited' as ChequeStatus,
                  reDepositedToBatchId: targetBatch.id,
                  reDepositedToBatchRef: targetBatch.batchRef,
                  reDepositedChequeId: clonedCheque.id,
                  bankCollectionStatus: 'Collected from Bank' as const,
                  collectedFromBankDate: c.collectedFromBankDate || today,
                  remarks: submission.remarks || c.remarks,
                  updatedAt: now,
                }
          )
          .concat(clonedCheque);

        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: sourceBatch?.id,
            batchRef: sourceBatch?.batchRef,
            chequeId: oldCheque.id,
            chequeNumber: oldCheque.chequeNumber,
            actionType: 'CHEQUE_REDEPOSITED',
            actor,
            description: `Moved bounced cheque #${oldCheque.chequeNumber} (${oldCheque.partyName}, ${formatINR(oldCheque.amount)}) to Re-Deposit (${nextPresCount}${presSuffix}-time presentation) in batch ${targetBatch.batchRef}.`,
            oldValue: oldCheque.status,
            newValue: 'Re-Deposited',
          })
        );

        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: targetBatch.id,
            batchRef: targetBatch.batchRef,
            chequeId: clonedCheque.id,
            chequeNumber: clonedCheque.chequeNumber,
            actionType: 'CHEQUE_REDEPOSITED',
            actor,
            description: `Scheduled ${nextPresCount}${presSuffix}-time presentation of cheque #${clonedCheque.chequeNumber} (${clonedCheque.partyName}, ${formatINR(clonedCheque.amount)}) in batch ${targetBatch.batchRef}.`,
            newValue: `Draft (${nextPresCount}${presSuffix} Presentation)`,
          })
        );
      }

      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== companyId
            ? comp
            : {
                ...comp,
                batches: nextBatches,
                cheques: nextCheques,
                activeBatchId: nextActiveBatchId,
              }
        ),
        auditLogs: [...newLogs, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleSaveProfile = (profile: CorporateProfile) => {
    updateActiveCompany((comp) => ({ ...comp, profile }));
  };

  const handleAddBankAccount = (account: Omit<CompanyBankAccount, 'id'>) => {
    const newAcc: CompanyBankAccount = {
      ...account,
      id: `acc-${Date.now()}`,
    };
    updateActiveCompany((comp) => ({
      ...comp,
      bankAccounts: [...comp.bankAccounts, newAcc],
    }));
  };

  const handleUpdateBankAccount = (
    id: string,
    patch: Partial<CompanyBankAccount>
  ) => {
    updateActiveCompany((comp) => ({
      ...comp,
      bankAccounts: comp.bankAccounts.map((acc) => {
        if (patch.isDefault) {
          return acc.id === id
            ? { ...acc, ...patch, isDefault: true }
            : { ...acc, isDefault: false };
        }
        return acc.id === id ? { ...acc, ...patch } : acc;
      }),
    }));
  };

  const handleDeleteBankAccount = (id: string) => {
    updateActiveCompany((comp) => ({
      ...comp,
      bankAccounts: comp.bankAccounts.filter((acc) => acc.id !== id),
    }));
  };

  const handleResetDemoData = () => {
    const fresh = resetTreasuryState();
    setState(fresh);
    setEditingCheque(null);
    setActiveModule('dashboard');
  };

  const handleExportFullBackup = () => {
    const result = exportFullBackupJson(state);
    setBackupNotice({
      type: 'success',
      message: `Full JSON backup downloaded (${result.filename}) — ${result.companyCount} ${result.companyCount === 1 ? 'company' : 'companies'}, ${result.batchCount} batches, ${result.chequeCount} cheques.`,
    });
  };

  const handleRestoreBackupFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = parseBackupJsonState(text);
      if (!parsed.ok) {
        setBackupNotice({ type: 'error', message: parsed.error });
        return;
      }
      setPendingRestore({ ...parsed, fileName: file.name });
    } catch {
      setBackupNotice({
        type: 'error',
        message: 'Failed to read the selected backup file.',
      });
    }
  };

  const handleConfirmRestoreBackup = () => {
    if (!pendingRestore) return;
    setState(pendingRestore.state);
    saveTreasuryState(pendingRestore.state);
    setEditingCheque(null);
    setCustomerNavSelection(null);
    setBackupNotice({
      type: 'success',
      message: `Backup restored from "${pendingRestore.fileName}" — ${pendingRestore.companyCount} ${pendingRestore.companyCount === 1 ? 'company' : 'companies'}, ${pendingRestore.batchCount} batches, and ${pendingRestore.chequeCount} cheques loaded.`,
    });
    setPendingRestore(null);
  };

  const currentActorName =
    currentUserRole === 'Admin'
      ? activeCompany.profile.defaultChecker || 'Treasury Admin'
      : activeCompany.profile.defaultMaker || 'Treasury Operator';

  const handleSaveCustomerProfile = (
    companyId: string,
    profile: CustomerProfile
  ) => {
    const key = getCustomerKey(profile.customerCode, profile.partyName);
    setState((prev) => ({
      ...prev,
      companies: prev.companies.map((comp) => {
        if (comp.id !== companyId) return comp;
        const existing = comp.customers || [];
        const matchIdx = existing.findIndex(
          (c) =>
            c.id === profile.id ||
            getCustomerKey(c.customerCode, c.partyName) === key
        );
        const nextCustomers =
          matchIdx >= 0
            ? existing.map((c, idx) => (idx === matchIdx ? profile : c))
            : [profile, ...existing];
        return {
          ...comp,
          customers: nextCustomers,
        };
      }),
    }));
  };

  const handleUploadCustomerDocuments = (
    companyId: string,
    docs: CustomerDocument[]
  ) => {
    if (docs.length === 0) return;
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp = prev.companies.find((c) => c.id === companyId);
      if (!targetComp) return prev;
      const newLogs = docs.map((doc) =>
        createAuditEntry({
          timestamp: doc.uploadedAt || now,
          companyId: targetComp.id,
          companyName: targetComp.profile.companyName,
          batchId: doc.linkedBatchId,
          batchRef: doc.linkedBatchRef,
          chequeId: doc.linkedChequeId,
          chequeNumber: doc.linkedChequeNumber,
          customerKey: doc.customerKey,
          customerName: doc.customerName,
          documentId: doc.id,
          documentTitle: doc.title,
          actionType: 'DOCUMENT_UPLOADED',
          actor: doc.uploadedBy,
          description: `Uploaded ${doc.docType} "${doc.title}" (${doc.fileName}) for ${doc.customerName}${doc.linkedChequeNumber ? ` (linked to Chq #${doc.linkedChequeNumber})` : ''}.`,
          newValue: doc.docType,
        })
      );
      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== companyId
            ? comp
            : {
                ...comp,
                documents: [...docs, ...(comp.documents || [])],
              }
        ),
        auditLogs: [...newLogs, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleDeleteCustomerDocument = (
    companyId: string,
    doc: CustomerDocument
  ) => {
    if (currentUserRole !== 'Admin') return;
    const now = new Date().toISOString();
    void deleteDocumentBlob(doc.id);
    setState((prev) => {
      const targetComp = prev.companies.find((c) => c.id === companyId);
      if (!targetComp) return prev;
      const actor = `${targetComp.profile.defaultChecker || 'Treasury Admin'} (Admin)`;
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: doc.linkedBatchId,
        batchRef: doc.linkedBatchRef,
        chequeId: doc.linkedChequeId,
        chequeNumber: doc.linkedChequeNumber,
        customerKey: doc.customerKey,
        customerName: doc.customerName,
        documentId: doc.id,
        documentTitle: doc.title,
        actionType: 'DOCUMENT_DELETED',
        actor,
        description: `Deleted ${doc.docType} "${doc.title}" (${doc.fileName}) from ${doc.customerName}'s document vault (Admin action).`,
        oldValue: doc.title,
        newValue: 'Deleted',
      });
      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== companyId
            ? comp
            : {
                ...comp,
                documents: (comp.documents || []).filter(
                  (d) => d.id !== doc.id
                ),
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleRecordDocumentShare = (
    companyId: string,
    params: {
      customerKey: string;
      customerName: string;
      documents: CustomerDocument[];
      recipientPhone: string;
      channel: 'WhatsApp Web' | 'Direct File Share' | 'Copy Link';
    }
  ) => {
    const now = new Date().toISOString();
    const sharedIds = new Set(params.documents.map((d) => d.id));
    setState((prev) => {
      const targetComp = prev.companies.find((c) => c.id === companyId);
      if (!targetComp) return prev;
      const actor =
        currentUserRole === 'Admin'
          ? `${targetComp.profile.defaultChecker || 'Treasury Admin'} (Admin)`
          : `${targetComp.profile.defaultMaker || 'Treasury Operator'} (Maker)`;
      const titles = params.documents.map((d) => `"${d.title}"`).join(', ');
      const firstDoc = params.documents[0];
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        batchId: firstDoc?.linkedBatchId,
        batchRef: firstDoc?.linkedBatchRef,
        chequeId: firstDoc?.linkedChequeId,
        chequeNumber: firstDoc?.linkedChequeNumber,
        customerKey: params.customerKey,
        customerName: params.customerName,
        documentId: firstDoc?.id,
        documentTitle:
          params.documents.length === 1
            ? firstDoc.title
            : `${params.documents.length} Documents`,
        actionType: 'DOCUMENT_SHARED',
        actor,
        description: `Shared ${params.documents.length} document${params.documents.length === 1 ? '' : 's'} (${titles}) with ${params.customerName} via ${params.channel} (${params.recipientPhone}).`,
        newValue: `${params.channel} → ${params.recipientPhone}`,
      });
      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== companyId
            ? comp
            : {
                ...comp,
                documents: (comp.documents || []).map((d) =>
                  sharedIds.has(d.id)
                    ? {
                        ...d,
                        shareCount: (d.shareCount ?? 0) + 1,
                        lastSharedAt: now,
                        lastSharedTo: params.recipientPhone,
                      }
                    : d
                ),
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleSaveSchedule = (
    payload: Omit<CustomerChequeSchedule, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const existingSchedules = targetComp.chequeSchedules || [];
      const existing = existingId
        ? existingSchedules.find((s) => s.id === existingId)
        : undefined;

      const totalVal = (payload.cheques || []).reduce(
        (sum, item) => sum + item.amount,
        0
      );

      if (existing) {
        const updated: CustomerChequeSchedule = {
          ...existing,
          ...payload,
          id: existing.id,
          createdAt: existing.createdAt,
          updatedAt: now,
        };
        const log = createAuditEntry({
          timestamp: now,
          companyId: targetComp.id,
          companyName: targetComp.profile.companyName,
          customerName: updated.customerName,
          actionType: 'SCHEDULE_UPDATED',
          actor: currentActorName,
          description: `Updated PDC/EMI cheque schedule for ${updated.customerName} (${updated.loanRefNo}) — ${updated.cheques.length} cheques (${formatINR(totalVal)}).`,
        });
        return {
          ...prev,
          companies: prev.companies.map((comp) =>
            comp.id !== targetComp.id
              ? comp
              : {
                  ...comp,
                  chequeSchedules: existingSchedules.map((s) =>
                    s.id === existing.id ? updated : s
                  ),
                }
          ),
          auditLogs: [log, ...(prev.auditLogs || [])],
        };
      }

      const created: CustomerChequeSchedule = {
        ...payload,
        id: `sch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        createdAt: now,
        updatedAt: now,
      };
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        customerName: created.customerName,
        actionType: 'SCHEDULE_CREATED',
        actor: currentActorName,
        description: `Created PDC/EMI cheque schedule for ${created.customerName} (${created.loanRefNo}) — ${created.cheques.length} cheques (${formatINR(totalVal)}).`,
      });
      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                chequeSchedules: [created, ...existingSchedules],
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleDeleteSchedule = (scheduleId: string) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const existing = (targetComp.chequeSchedules || []).find(
        (s) => s.id === scheduleId
      );
      if (!existing) return prev;

      for (const doc of existing.scannedDocuments || []) {
        void deleteDocumentBlob(doc.id);
      }

      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        customerName: existing.customerName,
        actionType: 'SCHEDULE_DELETED',
        actor: currentActorName,
        description: `Deleted PDC/EMI cheque schedule for ${existing.customerName} (${existing.loanRefNo}).`,
      });

      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                chequeSchedules: (comp.chequeSchedules || []).filter(
                  (s) => s.id !== scheduleId
                ),
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleAddBankHoliday = (holiday: Omit<BankHoliday, 'id'>) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const currentHolidays = targetComp.bankHolidays || [];
      const existsIdx = currentHolidays.findIndex(
        (h) => h.date === holiday.date
      );
      const nextHoliday: BankHoliday = {
        ...holiday,
        id:
          existsIdx >= 0
            ? currentHolidays[existsIdx].id
            : `hol-${holiday.date}-${Math.random().toString(36).slice(2, 6)}`,
      };
      const nextHolidays =
        existsIdx >= 0
          ? currentHolidays.map((h, idx) =>
              idx === existsIdx ? nextHoliday : h
            )
          : [...currentHolidays, nextHoliday];
      const nextSchedules = recalculateScheduleDates(
        targetComp.chequeSchedules || [],
        nextHolidays
      );
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        actionType: 'BANK_HOLIDAY_UPDATED',
        actor: currentActorName,
        description: `Added bank holiday "${holiday.name}" (${formatIndianDate(holiday.date)}) and recalculated pending scheduled cheque dates.`,
      });
      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                bankHolidays: nextHolidays,
                chequeSchedules: nextSchedules,
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleDeleteBankHoliday = (holidayId: string) => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const targetHol = (targetComp.bankHolidays || []).find(
        (h) => h.id === holidayId
      );
      if (!targetHol) return prev;
      const nextHolidays = (targetComp.bankHolidays || []).filter(
        (h) => h.id !== holidayId
      );
      const nextSchedules = recalculateScheduleDates(
        targetComp.chequeSchedules || [],
        nextHolidays
      );
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        actionType: 'BANK_HOLIDAY_UPDATED',
        actor: currentActorName,
        description: `Removed bank holiday "${targetHol.name}" (${formatIndianDate(targetHol.date)}) and recalculated pending scheduled cheque dates.`,
      });
      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                bankHolidays: nextHolidays,
                chequeSchedules: nextSchedules,
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleRestoreDefaultHolidays = () => {
    const now = new Date().toISOString();
    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const defaults = getDefaultIndianBankHolidays();
      const nextSchedules = recalculateScheduleDates(
        targetComp.chequeSchedules || [],
        defaults
      );
      const log = createAuditEntry({
        timestamp: now,
        companyId: targetComp.id,
        companyName: targetComp.profile.companyName,
        actionType: 'BANK_HOLIDAY_UPDATED',
        actor: currentActorName,
        description: `Restored default Indian & Tamil Nadu bank holiday calendar (${defaults.length} dates) and recalculated pending scheduled cheque dates.`,
      });
      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                bankHolidays: defaults,
                chequeSchedules: nextSchedules,
              }
        ),
        auditLogs: [log, ...(prev.auditLogs || [])],
      };
    });
  };

  const handleSendScheduledChequesToClearing = (
    selections: SendToClearingSelection[],
    depositDate: string,
    companyBankAccountId: string
  ) => {
    if (selections.length === 0) return;
    const now = new Date().toISOString();
    const selectionKeySet = new Set(
      selections.map((s) => `${s.scheduleId}::${s.scheduledChequeId}`)
    );

    setState((prev) => {
      const targetComp =
        prev.companies.find((c) => c.id === prev.activeCompanyId) ||
        prev.companies[0];
      const schedules = targetComp.chequeSchedules || [];
      const bankId =
        companyBankAccountId ||
        targetComp.bankAccounts.find((b) => b.isDefault)?.id ||
        targetComp.bankAccounts[0]?.id ||
        '';

      // Find an existing unlocked Clearing Batch matching depositDate + bankId
      let targetBatch = targetComp.batches.find(
        (b) =>
          !b.isLocked &&
          b.depositDate === depositDate &&
          b.companyBankAccountId === bankId
      );
      let createdBatch: ClearingBatch | undefined;
      if (!targetBatch) {
        const nextSeq =
          targetComp.batches.length +
          (targetComp.id === 'comp-bharat-precision' ? 42 : 1);
        createdBatch = {
          id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          batchRef: generateBatchRef(depositDate, nextSeq),
          depositDate,
          companyBankAccountId: bankId,
          makerName: targetComp.profile.defaultMaker,
          checkerName: targetComp.profile.defaultChecker,
          status: 'Draft',
          isLocked: false,
        };
        targetBatch = createdBatch;
      }

      const newCheques: ChequeEntry[] = [];
      let totalAddedAmount = 0;

      const nextSchedules = schedules.map((sch) => {
        let changed = false;
        const nextItems = (sch.cheques || []).map((item) => {
          const key = `${sch.id}::${item.id}`;
          if (!selectionKeySet.has(key) || item.status !== 'Scheduled') {
            return item;
          }
          changed = true;
          const newChequeId = `chq-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 7)}`;
          const chequeEntry: ChequeEntry = {
            id: newChequeId,
            batchId: targetBatch!.id,
            companyBankAccountId: bankId || sch.companyBankAccountId || '',
            chequeDate: item.originalDate,
            chequeNumber: item.chequeNumber,
            micrCode: sch.micrCode || '',
            draweeBank: sch.draweeBank,
            draweeBranch: sch.draweeBranch,
            clearingType:
              item.amount >= 200000
                ? 'High-Value Clearing'
                : 'Local CTS Clearing',
            partyName: sch.customerName,
            customerCode: sch.customerCode || '',
            invoiceRef: sch.loanRefNo,
            amount: item.amount,
            status: 'Draft',
            presentationCount: 1,
            remarks:
              sch.notes ||
              (item.shiftReason
                ? `Scheduled PDC (${item.shiftReason})`
                : 'Scheduled PDC Deposit'),
            createdAt: now,
            updatedAt: now,
          };
          newCheques.push(chequeEntry);
          totalAddedAmount += item.amount;
          return {
            ...item,
            status: 'In Clearing' as ScheduledChequeStatus,
            clearingBatchId: targetBatch!.id,
            clearingBatchRef: targetBatch!.batchRef,
            clearingChequeId: newChequeId,
            sentToClearingAt: now,
          };
        });
        return changed ? { ...sch, cheques: nextItems, updatedAt: now } : sch;
      });

      if (newCheques.length === 0) return prev;

      const newLogs: SystemAuditLogEntry[] = [];
      if (createdBatch) {
        newLogs.push(
          createAuditEntry({
            timestamp: now,
            companyId: targetComp.id,
            companyName: targetComp.profile.companyName,
            batchId: createdBatch.id,
            batchRef: createdBatch.batchRef,
            actionType: 'BATCH_CREATED',
            actor: currentActorName,
            description: `Auto-created clearing batch ${createdBatch.batchRef} for ${formatIndianDate(depositDate)} from scheduled deposits.`,
            newValue: 'Draft',
          })
        );
      }

      newLogs.push(
        createAuditEntry({
          timestamp: now,
          companyId: targetComp.id,
          companyName: targetComp.profile.companyName,
          batchId: targetBatch.id,
          batchRef: targetBatch.batchRef,
          actionType: 'SCHEDULED_CHEQUES_SENT_TO_CLEARING',
          actor: currentActorName,
          description: `Sent ${newCheques.length} scheduled cheque${newCheques.length === 1 ? '' : 's'} (${formatINR(totalAddedAmount)}) to clearing batch ${targetBatch.batchRef}.`,
          newValue: targetBatch.batchRef,
        })
      );

      return {
        ...prev,
        companies: prev.companies.map((comp) =>
          comp.id !== targetComp.id
            ? comp
            : {
                ...comp,
                batches: createdBatch
                  ? [createdBatch, ...comp.batches]
                  : comp.batches,
                activeBatchId: targetBatch!.id,
                cheques: [...comp.cheques, ...newCheques],
                chequeSchedules: nextSchedules,
              }
        ),
        auditLogs: [...newLogs, ...(prev.auditLogs || [])],
      };
    });
  };

  const todayIso = toIsoDate(new Date());
  const dueTodayScheduleCount = (activeCompany.chequeSchedules || []).reduce(
    (sum, sch) =>
      sum +
      (sch.cheques || []).filter(
        (chq) => chq.status === 'Scheduled' && chq.effectiveDate <= todayIso
      ).length,
    0
  );

  const companyReturnedCount = activeCompany.cheques.filter(
    (c) => c.status === 'Returned / Bounced'
  ).length;

  const navItems: {
    id: ActiveModule;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count?: number;
  }[] = [
    { id: 'dashboard', label: 'Clearing Dashboard', icon: LayoutDashboard },
    { id: 'entry', label: 'Rapid Cheque Entry', icon: FilePlus2 },
    {
      id: 'schedules',
      label: 'Customer Schedule',
      icon: CalendarCheck2,
      count: dueTodayScheduleCount,
    },
    { id: 'memo', label: 'Bank Deposit Memo', icon: Printer },
    {
      id: 'return-ack',
      label: 'Return Acknowledgement',
      icon: FileCheck2,
      count: companyReturnedCount,
    },
    {
      id: 'letters',
      label: 'Letters / NOC & DD',
      icon: ScrollText,
    },
    {
      id: 'return-analytics',
      label: 'Return Analytics',
      icon: BarChart3,
    },
    {
      id: 'audit-log',
      label: 'System Audit Log',
      icon: History,
      count: (state.auditLogs || []).length,
    },
    { id: 'settings', label: 'Corporate & Banks', icon: Building2 },
  ];

  const moduleTitleMap: Record<ActiveModule, string> = {
    dashboard: 'Clearing Schedule & Realization Ledger',
    entry: editingCheque ? 'Edit Instrument' : 'High-Speed Keyboard Cheque Entry',
    schedules: 'Customer PDC / EMI Cheque Schedule & Daily Deposit Planner',
    customers: 'Customer Profiles, Document Vault & WhatsApp Sharing',
    memo: 'Official A4 Bank Deposit Memo (PDF)',
    'return-ack': 'Returned Cheque Bank Acknowledgement Letter (PDF)',
    letters: 'Official Letters & Certificates (NOC & DD Cancellation)',
    'return-analytics': 'Returned Cheques Smart Analytics & Field Checklist',
    'audit-log': 'Global System Audit Log & Activity History',
    settings: 'Corporate Entity & Multi-Bank Treasury Setup',
  };

  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Executive Deep Navy Sidebar (Hidden in Print) */}
      <aside
        className={`no-print fixed inset-y-0 left-0 z-40 w-[248px] bg-[#0B192C] text-slate-100 flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 shrink-0 ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="px-5 py-5 border-b border-slate-800/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-md bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0">
                <Landmark className="w-4 h-4 text-white" aria-hidden="true" />
              </div>
              <span className="font-display text-sm font-bold tracking-tight text-white whitespace-nowrap truncate">
                ClearLedger
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMobileNavOpen(false)}
              className="lg:hidden p-1 text-slate-400 hover:text-white"
              aria-label="Close navigation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-3 space-y-1" aria-label="Primary">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id !== 'entry') setEditingCheque(null);
                    setActiveModule(item.id);
                    setMobileNavOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="flex-1 text-left">{item.label}</span>
                  {item.count !== undefined && item.count > 0 && (
                    <span className="text-[10px] font-mono-num font-semibold text-red-300">
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Active Corporate Switcher & Batch Context Footer in Sidebar */}
        <div className="p-4 border-t border-slate-800/80 space-y-3 text-xs">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-slate-400">
                Active Corporate Entity
              </span>
              <span className="text-[10px] font-mono-num text-slate-400">
                {state.companies.length} {state.companies.length === 1 ? 'Co.' : 'Cos.'}
              </span>
            </div>
            <select
              aria-label="Switch active company"
              value={activeCompany.id}
              onChange={(e) => handleSwitchCompany(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-medium text-white bg-slate-800 border border-slate-700 rounded-md focus:outline-none focus:ring-1 focus:ring-slate-500 truncate"
            >
              {state.companies.map((comp) => (
                <option key={comp.id} value={comp.id}>
                  {comp.profile.companyName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowAddCompanyModal(true)}
              className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-800/70 hover:bg-slate-800 border border-slate-700/80 rounded-md transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add New Company</span>
            </button>
          </div>

          <div className="pt-2.5 border-t border-slate-800/80 space-y-1 text-[11px] text-slate-400">
            <div className="flex justify-between gap-2">
              <span>Batch</span>
              <span className="font-mono-num text-slate-200">
                {activeBatch?.batchRef}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Batch Total</span>
              <span className="font-mono-num text-slate-200">
                {formatIndianShort(activeBatchTotal)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>Bank Accounts</span>
              <span className="font-mono-num text-slate-200">
                {activeCompany.bankAccounts.length}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Nav Backdrop */}
      {mobileNavOpen && (
        <div
          className="no-print fixed inset-0 z-30 bg-slate-950/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Main Workspace Viewport */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract (Hidden on Print) */}
        <header className="no-print h-14 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between gap-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              className="lg:hidden p-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-500 min-w-0 truncate">
              <span className="font-medium text-slate-700 whitespace-nowrap truncate max-w-[220px]">
                {activeCompany.profile.companyName}
              </span>
              <span aria-hidden="true">/</span>
              <span className="font-semibold text-slate-900 truncate">
                {moduleTitleMap[activeModule]}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportFullBackup}
              title="Download full JSON backup of all companies, cheques, batches, and audit logs"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export Full Backup (JSON)</span>
            </button>

            <input
              ref={headerBackupInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleRestoreBackupFile(file);
                }
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => headerBackupInputRef.current?.click()}
              title="Restore all company data from a saved JSON backup"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Restore Backup (JSON)</span>
            </button>

            {/* Active User Role Toggle (Admin vs Maker) */}
            <div
              className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[11px]"
              role="group"
              aria-label="Session User Role"
            >
              <button
                type="button"
                onClick={() => setCurrentUserRole('Admin')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded font-medium transition-colors ${
                  currentUserRole === 'Admin'
                    ? 'bg-[#0B192C] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                <span>Admin</span>
              </button>
              <button
                type="button"
                onClick={() => setCurrentUserRole('Maker')}
                className={`px-2.5 py-1 rounded font-medium transition-colors ${
                  currentUserRole === 'Maker'
                    ? 'bg-[#0B192C] text-white'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Maker
              </button>
            </div>

            {activeModule !== 'entry' ? (
              <button
                type="button"
                onClick={() => {
                  setEditingCheque(null);
                  setActiveModule('entry');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Log Cheque</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setActiveModule('memo')}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Print Deposit Memo</span>
              </button>
            )}
          </div>
        </header>

        {/* Main Content Canvas */}
        <main className="flex-1 p-4 sm:p-6 max-w-[1600px] w-full mx-auto print:p-0 print:max-w-none">
          {backupNotice && (
            <div
              role="status"
              className={`no-print mb-5 px-4 py-3 rounded-lg border text-xs flex items-center justify-between gap-3 ${
                backupNotice.type === 'success'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
            >
              <div className="flex items-center gap-2">
                {backupNotice.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
                )}
                <span>{backupNotice.message}</span>
              </div>
              <button
                type="button"
                onClick={() => setBackupNotice(null)}
                className="p-1 opacity-70 hover:opacity-100"
                aria-label="Dismiss backup notice"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {activeModule === 'dashboard' && (
            <DashboardView
              key={activeCompany.id}
              batches={activeCompany.batches}
              activeBatchId={activeCompany.activeBatchId}
              bankAccounts={activeCompany.bankAccounts}
              cheques={activeCompany.cheques}
              corporateCheckerPassword={
                activeCompany.profile.checkerPassword || 'TREASURY2026'
              }
              onSelectBatch={handleSelectBatch}
              onCreateBatch={handleCreateBatch}
              onUpdateBatch={handleUpdateBatch}
              onLockBatch={handleLockBatch}
              onUnlockBatch={handleUnlockBatch}
              onUpdateChequeStatus={handleUpdateChequeStatus}
              onDeleteCheque={handleDeleteCheque}
              onEditCheque={handleEditCheque}
              onNavigateRapidEntry={() => {
                setEditingCheque(null);
                setActiveModule('entry');
              }}
              onNavigatePrintMemo={() => setActiveModule('memo')}
              onNavigateReturnAck={(scope) => {
                setReturnAckScope(scope);
                setActiveModule('return-ack');
              }}
              onNavigateLetters={() => setActiveModule('letters')}
              onReconcileReturnedCheques={handleReconcileReturnedCheques}
              onExecuteRecoveryAction={(chequeId, submission) =>
                handleExecuteRecoveryAction(
                  activeCompany.id,
                  chequeId,
                  submission
                )
              }
              documents={activeCompany.documents || []}
              onOpenCustomerDocuments={({ customerKey, linkChequeId }) => {
                setCustomerNavSelection({
                  customerKey,
                  tab: 'documents',
                  linkChequeId,
                });
                setActiveModule('customers');
              }}
              auditLogs={(state.auditLogs || []).filter(
                (l) => l.companyId === activeCompany.id
              )}
              chequeSchedules={activeCompany.chequeSchedules || []}
              bankHolidays={activeCompany.bankHolidays || []}
              onSendScheduledChequesToClearing={
                handleSendScheduledChequesToClearing
              }
              onNavigateSchedules={() => setActiveModule('schedules')}
            />
          )}

          {activeModule === 'schedules' && (
            <CustomerScheduleView
              key={activeCompany.id}
              schedules={activeCompany.chequeSchedules || []}
              bankAccounts={activeCompany.bankAccounts}
              customers={activeCompany.customers || []}
              cheques={activeCompany.cheques}
              holidays={activeCompany.bankHolidays || []}
              onSaveSchedule={handleSaveSchedule}
              onDeleteSchedule={handleDeleteSchedule}
              onOpenBankHolidays={() => setShowBankHolidayDrawer(true)}
              onSendToClearingBatch={handleSendScheduledChequesToClearing}
            />
          )}

          {activeModule === 'customers' && (
            <CustomersView
              key={activeCompany.id}
              company={activeCompany}
              auditLogs={state.auditLogs || []}
              currentUserRole={currentUserRole}
              currentActorName={currentActorName}
              initialSelection={customerNavSelection}
              onClearInitialSelection={() => setCustomerNavSelection(null)}
              onSaveCustomerProfile={(profile) =>
                handleSaveCustomerProfile(activeCompany.id, profile)
              }
              onUploadDocuments={(docs) =>
                handleUploadCustomerDocuments(activeCompany.id, docs)
              }
              onDeleteDocument={(doc) =>
                handleDeleteCustomerDocument(activeCompany.id, doc)
              }
              onRecordDocumentShare={(params) =>
                handleRecordDocumentShare(activeCompany.id, params)
              }
            />
          )}

          {activeModule === 'entry' && (
            <RapidEntryView
              key={activeCompany.id}
              batches={activeCompany.batches}
              activeBatchId={activeCompany.activeBatchId}
              bankAccounts={activeCompany.bankAccounts}
              allCheques={activeCompany.cheques}
              editingCheque={editingCheque}
              auditLogs={(state.auditLogs || []).filter(
                (l) => l.companyId === activeCompany.id
              )}
              onCancelEdit={() => setEditingCheque(null)}
              onSaveCheque={handleSaveCheque}
              onDeleteCheque={handleDeleteCheque}
              onStartEdit={handleEditCheque}
            />
          )}

          {activeModule === 'memo' && (
            <PrintMemoView
              key={activeCompany.id}
              profile={activeCompany.profile}
              bankAccounts={activeCompany.bankAccounts}
              batches={activeCompany.batches}
              activeBatchId={activeCompany.activeBatchId}
              cheques={activeCompany.cheques}
            />
          )}

          {activeModule === 'return-ack' && (
            <ReturnAckView
              key={`${activeCompany.id}-${returnAckScope}`}
              profile={activeCompany.profile}
              bankAccounts={activeCompany.bankAccounts}
              batches={activeCompany.batches}
              activeBatchId={activeCompany.activeBatchId}
              cheques={activeCompany.cheques}
              initialScope={returnAckScope}
              onUpdateReturnReason={handleUpdateReturnReason}
              onLogReturnAck={handleLogReturnAck}
              onBackToDashboard={() => setActiveModule('dashboard')}
            />
          )}

          {activeModule === 'letters' && (
            <LettersCertificatesView
              key={activeCompany.id}
              profile={activeCompany.profile}
              bankAccounts={activeCompany.bankAccounts}
              customers={activeCompany.customers || []}
              cheques={activeCompany.cheques}
              onLogLetterGenerated={handleLogLetterGenerated}
            />
          )}

          {activeModule === 'return-analytics' && (
            <ReturnAnalyticsView
              key={activeCompany.id}
              companies={state.companies}
              activeCompany={activeCompany}
              auditLogs={state.auditLogs || []}
              onUpdateChequeRecovery={handleUpdateChequeRecovery}
              onExecuteRecoveryAction={handleExecuteRecoveryAction}
              onNavigateReturnAck={() => {
                setReturnAckScope('all');
                setActiveModule('return-ack');
              }}
            />
          )}

          {activeModule === 'audit-log' && (
            <SystemAuditLogView
              companies={state.companies}
              auditLogs={state.auditLogs || []}
            />
          )}

          {activeModule === 'settings' && (
            <SettingsView
              key={activeCompany.id}
              companies={state.companies}
              activeCompanyId={activeCompany.id}
              profile={activeCompany.profile}
              bankAccounts={activeCompany.bankAccounts}
              onSwitchCompany={handleSwitchCompany}
              onOpenAddCompany={() => setShowAddCompanyModal(true)}
              onDeleteCompany={handleDeleteCompany}
              onSaveProfile={handleSaveProfile}
              onAddBankAccount={handleAddBankAccount}
              onUpdateBankAccount={handleUpdateBankAccount}
              onDeleteBankAccount={handleDeleteBankAccount}
              onResetDemoData={handleResetDemoData}
              auditLogsCount={(state.auditLogs || []).length}
              onExportFullBackup={handleExportFullBackup}
              onRestoreBackupFile={handleRestoreBackupFile}
              bankHolidaysCount={(activeCompany.bankHolidays || []).length}
              onOpenBankHolidays={() => setShowBankHolidayDrawer(true)}
            />
          )}
        </main>
      </div>

      <BankHolidayDrawer
        isOpen={showBankHolidayDrawer}
        onClose={() => setShowBankHolidayDrawer(false)}
        holidays={activeCompany.bankHolidays || []}
        schedules={activeCompany.chequeSchedules || []}
        onAddHoliday={handleAddBankHoliday}
        onDeleteHoliday={handleDeleteBankHoliday}
        onRestoreDefaults={handleRestoreDefaultHolidays}
      />

      {showAddCompanyModal && (
        <AddCompanyModal
          onCreateCompany={handleCreateCompany}
          onClose={() => setShowAddCompanyModal(false)}
        />
      )}

      {deepLinkDoc && (
        <DocumentPreviewModal
          documentItem={deepLinkDoc}
          onClose={() => setDeepLinkDoc(null)}
        />
      )}

      {pendingRestore && (
        <div
          className="no-print fixed inset-0 z-50 bg-slate-950/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="restore-backup-title"
        >
          <div className="bg-white border border-slate-200 rounded-lg max-w-md w-full p-5 space-y-4 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="w-8 h-8 rounded-md bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4" aria-hidden="true" />
                </div>
                <div>
                  <h3
                    id="restore-backup-title"
                    className="text-sm font-semibold text-slate-900"
                  >
                    Confirm Full Backup Restore
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Review the backup summary before replacing current workspace data.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="p-1 text-slate-400 hover:text-slate-700"
                aria-label="Close restore confirmation"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-md p-3.5 text-xs space-y-1.5">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Backup File:</span>
                <strong className="font-mono-num text-slate-900 truncate max-w-[230px]">
                  {pendingRestore.fileName}
                </strong>
              </div>
              {pendingRestore.exportedAt && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">Exported At:</span>
                  <strong className="font-mono-num text-slate-900">
                    {new Date(pendingRestore.exportedAt).toLocaleString('en-IN')}
                  </strong>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Companies:</span>
                <strong className="font-mono-num text-slate-900">
                  {pendingRestore.companyCount}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Clearing Batches:</span>
                <strong className="font-mono-num text-slate-900">
                  {pendingRestore.batchCount}
                </strong>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Cheque Entries:</span>
                <strong className="font-mono-num text-slate-900">
                  {pendingRestore.chequeCount}
                </strong>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPendingRestore(null)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestoreBackup}
                className="px-4 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800"
              >
                Restore Backup Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
