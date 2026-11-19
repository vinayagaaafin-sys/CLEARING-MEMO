import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Download,
  Edit3,
  FileCheck2,
  FilePlus2,
  History,
  Lock,
  Paperclip,
  Printer,
  RotateCcw,
  ScrollText,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Unlock,
  Upload,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  BankHoliday,
  BatchStatus,
  ChequeEntry,
  ChequeStatus,
  ClearingBatch,
  CompanyBankAccount,
  CustomerChequeSchedule,
  CustomerDocument,
  SystemAuditLogEntry,
} from '../types/treasury';
import { getCustomerKey } from '../utils/customerHelpers';
import {
  evaluateChequeDate,
  formatIndianDate,
  formatIndianShort,
  formatINR,
} from '../utils/indianCurrency';
import { exportChequesToCSV, findDuplicateCheque } from '../services/treasuryStore';
import { ActivityTimeline, ChequeActivityDrawer } from './ActivityTimeline';
import {
  BankStatementReconcileModal,
  ReconcileConfirmItem,
} from './BankStatementReconcileModal';
import { BatchLockModal } from './BatchLockModal';
import { BounceModal } from './BounceModal';
import {
  DailyDepositScheduleWidget,
  SendToClearingSelection,
} from './DailyDepositScheduleWidget';
import {
  RecoveryActionModal,
  RecoveryActionSubmission,
} from './RecoveryActionModal';
import { ComplianceIndicator } from './StatusTag';

interface DashboardViewProps {
  batches: ClearingBatch[];
  activeBatchId: string;
  bankAccounts: CompanyBankAccount[];
  cheques: ChequeEntry[];
  corporateCheckerPassword: string;
  onSelectBatch: (batchId: string) => void;
  onCreateBatch: (depositDate: string, bankAccountId: string) => void;
  onUpdateBatch: (batchId: string, patch: Partial<ClearingBatch>) => void;
  onLockBatch: (batchId: string, password: string, actorName: string) => void;
  onUnlockBatch: (
    batchId: string,
    actorRole: 'Maker' | 'Checker',
    actorName: string,
    reason: string
  ) => void;
  onUpdateChequeStatus: (
    chequeIds: string[],
    status: ChequeStatus,
    bounceData?: {
      bounceReason: string;
      penaltyAmount: number;
      bouncedDate: string;
      remarks: string;
    }
  ) => void;
  onDeleteCheque: (chequeId: string) => void;
  onEditCheque: (cheque: ChequeEntry) => void;
  onNavigateRapidEntry: () => void;
  onNavigatePrintMemo: () => void;
  onNavigateReturnAck: (scope: 'active' | 'all') => void;
  onNavigateLetters?: () => void;
  onReconcileReturnedCheques: (
    updates: ReconcileConfirmItem[],
    fileName: string
  ) => void;
  onExecuteRecoveryAction?: (
    chequeId: string,
    submission: RecoveryActionSubmission
  ) => void;
  documents?: CustomerDocument[];
  onOpenCustomerDocuments?: (params: {
    customerKey: string;
    linkChequeId?: string;
  }) => void;
  auditLogs?: SystemAuditLogEntry[];
  chequeSchedules?: CustomerChequeSchedule[];
  bankHolidays?: BankHoliday[];
  onSendScheduledChequesToClearing?: (
    selections: SendToClearingSelection[],
    depositDate: string,
    companyBankAccountId: string
  ) => void;
  onNavigateSchedules?: () => void;
}

export function DashboardView({
  batches,
  activeBatchId,
  bankAccounts,
  cheques,
  corporateCheckerPassword,
  onSelectBatch,
  onCreateBatch,
  onUpdateBatch,
  onLockBatch,
  onUnlockBatch,
  onUpdateChequeStatus,
  onDeleteCheque,
  onEditCheque,
  onNavigateRapidEntry,
  onNavigatePrintMemo,
  onNavigateReturnAck,
  onNavigateLetters,
  onReconcileReturnedCheques,
  onExecuteRecoveryAction,
  documents = [],
  onOpenCustomerDocuments,
  auditLogs = [],
  chequeSchedules = [],
  bankHolidays = [],
  onSendScheduledChequesToClearing,
  onNavigateSchedules,
}: DashboardViewProps) {
  const [batchScope, setBatchScope] = useState<'active' | 'all'>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterBankId, setFilterBankId] = useState<string>('ALL');
  const [filterClearingType, setFilterClearingType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterCompliance, setFilterCompliance] = useState<'ALL' | 'ALERTS'>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bounceTarget, setBounceTarget] = useState<ChequeEntry | null>(null);
  const [recoveryTarget, setRecoveryTarget] = useState<ChequeEntry | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [lockModalMode, setLockModalMode] = useState<'lock' | 'unlock' | null>(null);
  const [showAuditHistory, setShowAuditHistory] = useState(false);
  const [historyDrawerCheque, setHistoryDrawerCheque] =
    useState<ChequeEntry | null>(null);
  const [showNewBatchModal, setShowNewBatchModal] = useState(false);
  const [newBatchDate, setNewBatchDate] = useState('2026-11-17');
  const [newBatchBankId, setNewBatchBankId] = useState(bankAccounts[0]?.id || '');
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileAlert, setReconcileAlert] = useState<{
    clearedCount: number;
    returnedCount: number;
    fileName: string;
  } | null>(null);

  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) || batches[0],
    [batches, activeBatchId]
  );

  const [draftBatchStatus, setDraftBatchStatus] = useState<BatchStatus>(
    activeBatch?.status || 'Draft'
  );
  const [batchStatusSaved, setBatchStatusSaved] = useState(false);

  useEffect(() => {
    setDraftBatchStatus(activeBatch?.status || 'Draft');
    setBatchStatusSaved(false);
  }, [activeBatch?.id, activeBatch?.status]);

  const bankMap = useMemo(
    () => new Map(bankAccounts.map((a) => [a.id, a])),
    [bankAccounts]
  );
  const batchMap = useMemo(
    () => new Map(batches.map((b) => [b.id, b])),
    [batches]
  );

  // Base scope cheques (Active Batch vs All Batches)
  const scopedCheques = useMemo(() => {
    if (batchScope === 'all') return cheques;
    return cheques.filter((c) => c.batchId === activeBatch?.id);
  }, [cheques, batchScope, activeBatch]);

  const scopedReturnedCount = useMemo(
    () => scopedCheques.filter((c) => c.status === 'Returned / Bounced').length,
    [scopedCheques]
  );

  // Filtered cheques
  const filteredCheques = useMemo(() => {
    return scopedCheques.filter((c) => {
      const batch = batchMap.get(c.batchId);
      const depositDate = batch?.depositDate || '2026-11-17';
      const evalDate = evaluateChequeDate(c.chequeDate, depositDate);
      const isDup = Boolean(
        findDuplicateCheque(cheques, c.chequeNumber, c.draweeBank, c.id)
      );

      if (filterBankId !== 'ALL' && c.companyBankAccountId !== filterBankId) {
        return false;
      }
      if (filterClearingType !== 'ALL' && c.clearingType !== filterClearingType) {
        return false;
      }
      if (filterStatus !== 'ALL' && c.status !== filterStatus) {
        return false;
      }
      if (
        filterCompliance === 'ALERTS' &&
        evalDate.flag === 'VALID' &&
        !isDup
      ) {
        return false;
      }
      if (dateFrom && c.chequeDate < dateFrom) return false;
      if (dateTo && c.chequeDate > dateTo) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = [
          c.partyName,
          c.chequeNumber,
          c.micrCode,
          c.draweeBank,
          c.draweeBranch,
          c.invoiceRef,
          c.customerCode,
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    scopedCheques,
    cheques,
    batchMap,
    filterBankId,
    filterClearingType,
    filterStatus,
    filterCompliance,
    dateFrom,
    dateTo,
    searchQuery,
  ]);

  // Executive KPIs computed over filteredCheques (or scopedCheques for summary clarity)
  const kpis = useMemo(() => {
    let totalAmount = 0;
    let highValueCount = 0;
    let highValueAmount = 0;
    let clearedAmount = 0;
    let clearedCount = 0;
    let pendingAmount = 0;
    let pendingCount = 0;
    let bouncedAmount = 0;
    let bouncedCount = 0;
    let pdcOrStaleCount = 0;

    for (const c of filteredCheques) {
      totalAmount += c.amount;
      if (c.amount >= 200000) {
        highValueCount += 1;
        highValueAmount += c.amount;
      }
      if (c.status === 'Cleared') {
        clearedAmount += c.amount;
        clearedCount += 1;
      } else if (c.status === 'Settled / Recovered') {
        const paid = Math.min(c.amount, Math.max(0, c.recoveredAmount ?? c.amount));
        clearedAmount += paid;
        clearedCount += 1;
        if (paid < c.amount) {
          bouncedAmount += c.amount - paid;
        }
      } else if (c.status === 'Returned / Bounced') {
        bouncedAmount += c.amount;
        bouncedCount += 1;
      } else if (c.status !== 'Re-Deposited') {
        pendingAmount += c.amount;
        pendingCount += 1;
      }
      const batch = batchMap.get(c.batchId);
      const ev = evaluateChequeDate(c.chequeDate, batch?.depositDate || '2026-11-17');
      if (ev.flag !== 'VALID') {
        pdcOrStaleCount += 1;
      }
    }

    return {
      totalAmount,
      totalCount: filteredCheques.length,
      highValueCount,
      highValueAmount,
      clearedAmount,
      clearedCount,
      pendingAmount,
      pendingCount,
      bouncedAmount,
      bouncedCount,
      pdcOrStaleCount,
    };
  }, [filteredCheques, batchMap]);

  // High-level Batch Pipeline summary across all company batches
  const batchPipeline = useMemo(() => {
    const amountByBatchId = new Map<string, number>();
    const countByBatchId = new Map<string, number>();
    for (const c of cheques) {
      amountByBatchId.set(c.batchId, (amountByBatchId.get(c.batchId) || 0) + c.amount);
      countByBatchId.set(c.batchId, (countByBatchId.get(c.batchId) || 0) + 1);
    }

    const stages: {
      key: BatchStatus;
      label: string;
      barColor: string;
      dotColor: string;
      textColor: string;
      count: number;
      amount: number;
      chequeCount: number;
      firstBatchId?: string;
    }[] = [
      {
        key: 'Draft',
        label: 'Draft',
        barColor: 'bg-slate-500',
        dotColor: 'bg-slate-500',
        textColor: 'text-slate-700',
        count: 0,
        amount: 0,
        chequeCount: 0,
      },
      {
        key: 'Submitted to Bank',
        label: 'Submitted to Bank',
        barColor: 'bg-sky-600',
        dotColor: 'bg-sky-600',
        textColor: 'text-sky-800',
        count: 0,
        amount: 0,
        chequeCount: 0,
      },
      {
        key: 'Partially Realized',
        label: 'Partially Realized',
        barColor: 'bg-amber-500',
        dotColor: 'bg-amber-500',
        textColor: 'text-amber-800',
        count: 0,
        amount: 0,
        chequeCount: 0,
      },
      {
        key: 'Cleared',
        label: 'Cleared',
        barColor: 'bg-emerald-600',
        dotColor: 'bg-emerald-600',
        textColor: 'text-emerald-800',
        count: 0,
        amount: 0,
        chequeCount: 0,
      },
      {
        key: 'Returned / Bounced',
        label: 'Returned / Bounced',
        barColor: 'bg-red-600',
        dotColor: 'bg-red-600',
        textColor: 'text-red-800',
        count: 0,
        amount: 0,
        chequeCount: 0,
      },
    ];

    const stageMap = new Map(stages.map((s) => [s.key, s]));
    let totalPipelineAmount = 0;
    let lockedCount = 0;
    let pendingApprovalCount = 0;
    let unlockedDraftCount = 0;

    for (const b of batches) {
      const status: BatchStatus = b.status || 'Draft';
      const stage = stageMap.get(status) || stages[0];
      const batchAmt = amountByBatchId.get(b.id) || 0;
      const batchChqCount = countByBatchId.get(b.id) || 0;

      stage.count += 1;
      stage.amount += batchAmt;
      stage.chequeCount += batchChqCount;
      if (!stage.firstBatchId) stage.firstBatchId = b.id;
      totalPipelineAmount += batchAmt;

      if (b.isLocked) {
        lockedCount += 1;
      } else if (status === 'Draft') {
        unlockedDraftCount += 1;
      } else {
        pendingApprovalCount += 1;
      }
    }

    const totalBatches = batches.length;
    const maxStageCount = Math.max(1, ...stages.map((s) => s.count));

    return {
      totalBatches,
      totalPipelineAmount,
      maxStageCount,
      stages,
      governance: [
        {
          key: 'draft',
          label: 'Draft (Open)',
          count: unlockedDraftCount,
          barColor: 'bg-slate-400',
          textColor: 'text-slate-700',
        },
        {
          key: 'pending',
          label: 'Pending Checker Lock',
          count: pendingApprovalCount,
          barColor: 'bg-amber-500',
          textColor: 'text-amber-800',
        },
        {
          key: 'locked',
          label: 'Locked (Approved)',
          count: lockedCount,
          barColor: 'bg-emerald-600',
          textColor: 'text-emerald-800',
        },
      ],
    };
  }, [batches, cheques]);

  const allSelected =
    filteredCheques.length > 0 &&
    filteredCheques.every((c) => selectedIds.includes(c.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredCheques.map((c) => c.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleBulkStatus = (status: ChequeStatus) => {
    if (selectedIds.length === 0) return;
    onUpdateChequeStatus(selectedIds, status);
    setSelectedIds([]);
  };

  const resetFilters = () => {
    setSearchQuery('');
    setFilterBankId('ALL');
    setFilterClearingType('ALL');
    setFilterStatus('ALL');
    setFilterCompliance('ALL');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters =
    searchQuery ||
    filterBankId !== 'ALL' ||
    filterClearingType !== 'ALL' ||
    filterStatus !== 'ALL' ||
    filterCompliance !== 'ALL' ||
    dateFrom ||
    dateTo;

  const isBatchLocked = batchScope === 'active' && Boolean(activeBatch?.isLocked);

  return (
    <div className="space-y-6">
      {/* Top Priority Card: Today's Scheduled Cheques to Deposit */}
      {onSendScheduledChequesToClearing && (
        <DailyDepositScheduleWidget
          schedules={chequeSchedules}
          bankAccounts={bankAccounts}
          holidays={bankHolidays}
          onSendToClearingBatch={onSendScheduledChequesToClearing}
          onNavigateSchedules={onNavigateSchedules}
        />
      )}

      {/* KPI Summary Strip - 4 clean flat cells with hairline dividers */}
      <section
        aria-label="Treasury KPIs"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white border border-slate-200 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-200"
      >
        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            {batchScope === 'active' ? 'Batch Deposit Total' : 'Consolidated Schedule Total'}
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 font-mono-num">
            {formatINR(kpis.totalAmount)}
          </div>
          <div className="mt-1.5 text-xs text-slate-600 flex items-center gap-2">
            <span className="font-semibold text-slate-800 font-mono-num">
              {formatIndianShort(kpis.totalAmount)}
            </span>
            <span aria-hidden="true">·</span>
            <span>{batchScope === 'active' ? activeBatch?.batchRef : `${batches.length} Batches`}</span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">Total Instruments</div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 font-mono-num">
            {kpis.totalCount} Cheques
          </div>
          <div className="mt-1.5 text-xs text-slate-600 flex items-center gap-2">
            <span>{kpis.clearedCount} Cleared</span>
            <span aria-hidden="true">·</span>
            <span>{kpis.pendingCount} In Pipeline</span>
            {kpis.pdcOrStaleCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-700 font-medium">
                  {kpis.pdcOrStaleCount} Hold Alert
                </span>
              </>
            )}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            High-Value Clearing (≥ ₹2 Lakhs)
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 font-mono-num">
            {kpis.highValueCount} Cheques
          </div>
          <div className="mt-1.5 text-xs text-slate-600 flex items-center gap-2">
            <span className="font-mono-num font-medium text-slate-800">
              {formatINR(kpis.highValueAmount)}
            </span>
            <span aria-hidden="true">·</span>
            <span>{formatIndianShort(kpis.highValueAmount)}</span>
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-500">
            Realization vs. Pending
          </div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-emerald-700 font-mono-num">
              {formatIndianShort(kpis.clearedAmount)}
            </span>
            <span className="text-xs text-slate-400">/</span>
            <span className="text-base font-semibold text-slate-700 font-mono-num">
              {formatIndianShort(kpis.pendingAmount)} pending
            </span>
          </div>
          <div className="mt-1.5 text-xs text-slate-600 flex items-center gap-2">
            <span>Cleared: {formatINR(kpis.clearedAmount)}</span>
            {kpis.bouncedCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-red-700 font-medium">
                  {kpis.bouncedCount} Bounced ({formatIndianShort(kpis.bouncedAmount)})
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Treasury Batch Pipeline Overview Card */}
      <section
        aria-label="Treasury Batch Pipeline Overview"
        className="bg-white border border-slate-200 rounded-lg p-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-slate-100 border border-slate-200 text-slate-800 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Treasury Batch Pipeline
              </h2>
              <p className="text-xs text-slate-500">
                High-level status distribution across {batchPipeline.totalBatches}{' '}
                clearing batch{batchPipeline.totalBatches === 1 ? '' : 'es'} · Total Value{' '}
                <span className="font-mono-num font-semibold text-slate-700">
                  {formatINR(batchPipeline.totalPipelineAmount)}
                </span>
              </p>
            </div>
          </div>

          {batchPipeline.totalBatches > 0 && (
            <div className="flex flex-wrap items-center gap-4 text-xs">
              {batchPipeline.governance.map((gov) => {
                const pct = Math.round(
                  (gov.count / batchPipeline.totalBatches) * 100
                );
                return (
                  <div key={gov.key} className="flex items-center gap-1.5">
                    <span
                      className={`w-2 h-2 rounded-full ${gov.barColor}`}
                      aria-hidden="true"
                    />
                    <span className="text-slate-600">{gov.label}:</span>
                    <span className={`font-mono-num font-semibold ${gov.textColor}`}>
                      {gov.count} ({pct}%)
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {batchPipeline.totalBatches === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No clearing batches created yet. Create a batch to track the treasury clearing pipeline.
          </div>
        ) : (
          <div className="pt-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Horizontal Bar Chart by Batch Workflow Status */}
            <div className="lg:col-span-8 space-y-2.5">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <span>Batch Stage Breakdown</span>
                <span>Batches · Value</span>
              </div>
              <div className="space-y-2">
                {batchPipeline.stages.map((stage) => {
                  const pct = Math.round(
                    (stage.count / batchPipeline.totalBatches) * 100
                  );
                  const barWidthPct =
                    stage.count > 0
                      ? Math.max(6, Math.round((stage.count / batchPipeline.maxStageCount) * 100))
                      : 0;
                  const canSelect = Boolean(stage.firstBatchId);

                  return (
                    <button
                      key={stage.key}
                      type="button"
                      disabled={!canSelect}
                      onClick={() => {
                        if (stage.firstBatchId) {
                          onSelectBatch(stage.firstBatchId);
                          setBatchScope('active');
                          setSelectedIds([]);
                        }
                      }}
                      title={
                        canSelect
                          ? `View ${stage.label} batch in ledger`
                          : `No batches in ${stage.label} status`
                      }
                      className={`w-full grid grid-cols-12 items-center gap-3 text-left py-1 px-1.5 -mx-1.5 rounded transition-colors ${
                        canSelect
                          ? 'hover:bg-slate-50 cursor-pointer'
                          : 'opacity-55 cursor-default'
                      }`}
                    >
                      <div className="col-span-4 sm:col-span-3 flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${stage.dotColor}`}
                          aria-hidden="true"
                        />
                        <span className="text-xs font-medium text-slate-800 truncate">
                          {stage.label}
                        </span>
                      </div>

                      <div className="col-span-4 sm:col-span-5">
                        <div className="h-2.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${stage.barColor}`}
                            style={{ width: `${barWidthPct}%` }}
                          />
                        </div>
                      </div>

                      <div className="col-span-4 text-right font-mono-num text-xs whitespace-nowrap">
                        <span className={`font-semibold ${stage.textColor}`}>
                          {stage.count}
                        </span>
                        <span className="text-slate-400 ml-1">({pct}%)</span>
                        <span className="hidden sm:inline text-slate-500 ml-2">
                          · {formatIndianShort(stage.amount)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right: Stacked Progress Indicator for Approval & Lock Readiness */}
            <div className="lg:col-span-4 lg:border-l lg:border-slate-200 lg:pl-6 space-y-3">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                <span>Approval &amp; Lock Progress</span>
                <span className="font-mono-num text-slate-700">
                  {Math.round(
                    ((batchPipeline.governance[2]?.count || 0) /
                      batchPipeline.totalBatches) *
                      100
                  )}
                  % Locked
                </span>
              </div>

              {/* Segmented Pipeline Progress Bar */}
              <div
                className="h-3.5 w-full bg-slate-100 rounded-full overflow-hidden flex"
                role="img"
                aria-label="Batch lock progress indicator"
              >
                {batchPipeline.governance.map((gov) => {
                  const widthPct = (gov.count / batchPipeline.totalBatches) * 100;
                  if (widthPct <= 0) return null;
                  return (
                    <div
                      key={gov.key}
                      style={{ width: `${widthPct}%` }}
                      title={`${gov.label}: ${gov.count} batch(es)`}
                      className={`h-full ${gov.barColor} transition-all duration-300`}
                    />
                  );
                })}
              </div>

              <div className="space-y-2 pt-1">
                {batchPipeline.governance.map((gov) => {
                  const pct = Math.round(
                    (gov.count / batchPipeline.totalBatches) * 100
                  );
                  return (
                    <div
                      key={gov.key}
                      className="flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2 text-slate-700">
                        <span
                          className={`w-2.5 h-2.5 rounded-xs ${gov.barColor}`}
                          aria-hidden="true"
                        />
                        <span>{gov.label}</span>
                      </div>
                      <div className="font-mono-num">
                        <span className={`font-semibold ${gov.textColor}`}>
                          {gov.count}
                        </span>
                        <span className="text-slate-400 ml-1">({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Maker-Checker Audit & Batch Lock Control */}
      {activeBatch && (
        <section
          aria-label="Batch Audit & Maker-Checker Controls"
          className="bg-white border border-slate-200 rounded-lg p-5"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center p-0.5 bg-slate-100 rounded-md border border-slate-200">
                <button
                  type="button"
                  onClick={() => setBatchScope('active')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    batchScope === 'active'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Active Batch
                </button>
                <button
                  type="button"
                  onClick={() => setBatchScope('all')}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                    batchScope === 'all'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Batches ({batches.length})
                </button>
              </div>

              {batchScope === 'active' && (
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Select clearing batch"
                    value={activeBatch.id}
                    onChange={(e) => {
                      onSelectBatch(e.target.value);
                      setSelectedIds([]);
                    }}
                    className="px-3 py-1.5 text-xs font-mono-num font-semibold text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  >
                    {batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.batchRef} ({formatIndianDate(b.depositDate)})
                        {b.isLocked ? ' — LOCKED' : ''}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => {
                      setNewBatchBankId(activeBatch.companyBankAccountId);
                      setShowNewBatchModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>New Batch</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {batchScope === 'active' && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowAuditHistory((v) => !v)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-md transition-colors whitespace-nowrap ${
                      showAuditHistory
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <History className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      Activity History (
                      {
                        auditLogs.filter((l) => l.batchId === activeBatch.id)
                          .length
                      }
                      )
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setLockModalMode(activeBatch.isLocked ? 'unlock' : 'lock')
                    }
                    className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                      activeBatch.isLocked
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                        : 'bg-white text-slate-800 border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    {activeBatch.isLocked ? (
                      <>
                        <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Locked · Checker Bypass to Unlock</span>
                      </>
                    ) : (
                      <>
                        <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Lock Batch</span>
                      </>
                    )}
                  </button>
                </>
              )}

              <button
                type="button"
                disabled={scopedReturnedCount === 0}
                onClick={() => onNavigateReturnAck(batchScope)}
                title={
                  scopedReturnedCount > 0
                    ? `Generate acknowledgement letter for ${scopedReturnedCount} returned cheque(s)`
                    : 'Mark at least one cheque as Returned / Bounced to enable acknowledgement generation'
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-red-800 bg-red-50 border border-red-200 rounded-md hover:bg-red-100 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-200 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
              >
                <FileCheck2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  Generate Return Cheque Acknowledgement
                  {scopedReturnedCount > 0 ? ` (${scopedReturnedCount})` : ''}
                </span>
              </button>

              <button
                type="button"
                onClick={onNavigatePrintMemo}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Preview &amp; Print Bank Memo</span>
              </button>

              {onNavigateLetters && (
                <button
                  type="button"
                  onClick={onNavigateLetters}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  <ScrollText className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Letters / NOC &amp; DD</span>
                </button>
              )}
            </div>
          </div>

          {isBatchLocked && (
            <div className="mt-4 p-3 bg-slate-900 text-slate-100 rounded-md text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>Read-Only Batch Lock Active:</strong> Locked by{' '}
                  {activeBatch.lockedBy || activeBatch.checkerName}
                  {activeBatch.lockedAt
                    ? ` on ${new Date(activeBatch.lockedAt).toLocaleString('en-IN')}`
                    : ''}
                  . Batch fields, cheque amounts, and core details are read-only;{' '}
                  <strong className="text-emerald-300">Status remains editable</strong> at any time.
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLockModalMode('unlock')}
                className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-[11px] font-medium text-white whitespace-nowrap shrink-0 self-start sm:self-auto"
              >
                Unlock via Password
              </button>
            </div>
          )}

          {batchScope === 'active' && showAuditHistory && (
            <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-900">
                  Batch Activity History &amp; Audit Timeline · {activeBatch.batchRef}
                </div>
                <button
                  type="button"
                  onClick={() => setShowAuditHistory(false)}
                  className="text-[11px] text-slate-500 hover:text-slate-900"
                >
                  Hide
                </button>
              </div>
              <div className="max-h-72 overflow-y-auto pr-1">
                <ActivityTimeline
                  entries={auditLogs.filter((l) => l.batchId === activeBatch.id)}
                  emptyMessage="No activity recorded for this batch yet."
                />
              </div>
            </div>
          )}

          {batchScope === 'active' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 pt-4">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
                  {activeBatch.isLocked && (
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>Deposit Schedule Date</span>
                </label>
                <input
                  type="date"
                  disabled={activeBatch.isLocked}
                  value={activeBatch.depositDate}
                  onChange={(e) =>
                    onUpdateBatch(activeBatch.id, { depositDate: e.target.value })
                  }
                  className="w-full px-3 py-1.5 text-xs font-mono-num border border-slate-300 rounded-md bg-white text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
                  {activeBatch.isLocked && (
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>Prepared By (Maker)</span>
                </label>
                <input
                  type="text"
                  disabled={activeBatch.isLocked}
                  value={activeBatch.makerName}
                  onChange={(e) =>
                    onUpdateBatch(activeBatch.id, { makerName: e.target.value })
                  }
                  placeholder="Maker name & designation"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
                  {activeBatch.isLocked && (
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" aria-hidden="true" />
                  )}
                  <span>Verified / Approved By (Checker)</span>
                </label>
                <input
                  type="text"
                  disabled={activeBatch.isLocked}
                  value={activeBatch.checkerName}
                  onChange={(e) =>
                    onUpdateBatch(activeBatch.id, { checkerName: e.target.value })
                  }
                  placeholder="Checker name & designation"
                  className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 disabled:bg-slate-100 disabled:text-slate-500 disabled:border-slate-200 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label
                    htmlFor="batch-status-select"
                    className="text-xs font-medium text-slate-700"
                  >
                    Batch Status
                  </label>
                  {activeBatch.isLocked && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700">
                      <Unlock className="w-2.5 h-2.5" aria-hidden="true" />
                      <span>Editable</span>
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    id="batch-status-select"
                    value={draftBatchStatus}
                    onChange={(e) => {
                      setDraftBatchStatus(e.target.value as BatchStatus);
                      setBatchStatusSaved(false);
                    }}
                    className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-semibold border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/20"
                  >
                    <option value="Draft">Draft</option>
                    <option value="Submitted to Bank">Submitted to Bank</option>
                    <option value="Partially Realized">Partially Realized</option>
                    <option value="Cleared">Cleared</option>
                    <option value="Returned / Bounced">Returned / Bounced</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      onUpdateBatch(activeBatch.id, { status: draftBatchStatus });
                      setBatchStatusSaved(true);
                      setTimeout(() => setBatchStatusSaved(false), 2500);
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    {batchStatusSaved ? 'Updated' : 'Update'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Filters & Tally/SAP Export Toolbar */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2.5 flex-1">
              <div className="relative min-w-[240px] flex-1 max-w-sm">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search party, cheque #, invoice, MICR..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <select
                aria-label="Filter by deposit bank account"
                value={filterBankId}
                onChange={(e) => setFilterBankId(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
              >
                <option value="ALL">All Deposit Accounts</option>
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} — {acc.accountType}
                  </option>
                ))}
              </select>

              <select
                aria-label="Filter by clearing type"
                value={filterClearingType}
                onChange={(e) => setFilterClearingType(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
              >
                <option value="ALL">All Clearing Types</option>
                <option value="High-Value Clearing">High-Value Clearing</option>
                <option value="Local CTS Clearing">Local CTS Clearing</option>
                <option value="Same-Bank Transfer">Same-Bank Transfer</option>
                <option value="Outstation">Outstation</option>
              </select>

              <select
                aria-label="Filter by status"
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
              >
                <option value="ALL">All Statuses</option>
                <option value="Draft">Draft</option>
                <option value="Submitted to Bank">Submitted to Bank</option>
                <option value="Cleared">Cleared</option>
                <option value="Returned / Bounced">Returned / Bounced</option>
                <option value="Settled / Recovered">Settled / Recovered</option>
                <option value="Re-Deposited">Re-Deposited</option>
              </select>

              <select
                aria-label="Filter by compliance alerts"
                value={filterCompliance}
                onChange={(e) =>
                  setFilterCompliance(e.target.value as 'ALL' | 'ALERTS')
                }
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
              >
                <option value="ALL">All Instruments</option>
                <option value="ALERTS">PDC / Stale / Duplicate Alerts</option>
              </select>

              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <span>Chq Date:</span>
                <input
                  type="date"
                  aria-label="Cheque date from"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
                />
                <span>to</span>
                <input
                  type="date"
                  aria-label="Cheque date to"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="px-2 py-1 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
                />
              </div>

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" aria-hidden="true" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowReconcileModal(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Upload Bank Statement</span>
              </button>
              <button
                type="button"
                onClick={() => exportChequesToCSV(filteredCheques, batches, bankAccounts)}
                disabled={filteredCheques.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Export CSV (Tally / SAP)</span>
              </button>
            </div>
          </div>

          {recoveryNotice && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-950"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className="w-4 h-4 text-emerald-700 shrink-0"
                  aria-hidden="true"
                />
                <span>{recoveryNotice}</span>
              </div>
              <button
                type="button"
                onClick={() => setRecoveryNotice(null)}
                aria-label="Dismiss recovery alert"
                className="p-1 text-emerald-700 hover:text-emerald-950 rounded hover:bg-emerald-100 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {reconcileAlert && (
            <div
              role="status"
              className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-950"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2
                  className="w-4 h-4 text-emerald-700 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  <strong className="font-semibold">
                    {reconcileAlert.clearedCount > 0 &&
                      `${reconcileAlert.clearedCount} cheque${
                        reconcileAlert.clearedCount === 1 ? '' : 's'
                      } marked Cleared`}
                    {reconcileAlert.clearedCount > 0 &&
                      reconcileAlert.returnedCount > 0 &&
                      ' · '}
                    {reconcileAlert.returnedCount > 0 &&
                      `${reconcileAlert.returnedCount} cheque${
                        reconcileAlert.returnedCount === 1 ? '' : 's'
                      } marked Returned`}
                  </strong>{' '}
                  <span className="text-emerald-800">
                    from {reconcileAlert.fileName}. Ledger statuses have been
                    updated across all matched batches.
                  </span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                {scopedReturnedCount > 0 && (
                  <button
                    type="button"
                    onClick={() => onNavigateReturnAck(batchScope)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-red-800 bg-white border border-red-200 rounded hover:bg-red-50 transition-colors whitespace-nowrap"
                  >
                    <FileCheck2 className="w-3 h-3" aria-hidden="true" />
                    <span>Generate Return Cheque Acknowledgement</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setReconcileAlert(null)}
                  aria-label="Dismiss reconciliation alert"
                  className="p-1 text-emerald-700 hover:text-emerald-950 rounded hover:bg-emerald-100 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Bulk Action Bar when rows are selected */}
          {selectedIds.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2 bg-slate-900 text-white rounded-md text-xs">
              <div className="font-medium">
                {selectedIds.length} instrument{selectedIds.length > 1 ? 's' : ''} selected
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleBulkStatus('Submitted to Bank')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs font-medium transition-colors"
                >
                  <Send className="w-3 h-3" aria-hidden="true" />
                  <span>Mark Submitted</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkStatus('Cleared')}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 hover:bg-emerald-600 rounded text-xs font-medium transition-colors"
                >
                  <Check className="w-3 h-3" aria-hidden="true" />
                  <span>Mark Cleared</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIds([])}
                  className="px-2.5 py-1 text-slate-300 hover:text-white transition-colors"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}
        </div>

        {/* High-Density Clearing Ledger Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600 tracking-wide">
                <th className="py-2.5 pl-4 pr-2 w-9">
                  <input
                    type="checkbox"
                    aria-label="Select all visible cheques"
                    disabled={filteredCheques.length === 0}
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300 text-slate-900 focus:ring-slate-900 disabled:opacity-40"
                  />
                </th>
                <th className="py-2.5 px-2.5 w-11">S.No</th>
                <th className="py-2.5 px-3">Cheque Date</th>
                <th className="py-2.5 px-3">Cheque # / MICR</th>
                <th className="py-2.5 px-3">Drawee Bank &amp; Branch</th>
                <th className="py-2.5 px-3">Party / Invoice Ref</th>
                <th className="py-2.5 px-3">Clearing &amp; Deposit A/c</th>
                <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 pl-3 pr-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filteredCheques.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 px-6 text-center">
                    <div className="max-w-md mx-auto space-y-2">
                      <p className="text-sm font-medium text-slate-900">
                        No cheques match the current view
                      </p>
                      <p className="text-xs text-slate-500">
                        {hasActiveFilters
                          ? 'Clear your search or filter criteria to inspect all instruments in this schedule.'
                          : 'Start logging corporate cheques into this clearing batch using high-speed keyboard entry.'}
                      </p>
                      <div className="pt-2 flex items-center justify-center gap-3">
                        {hasActiveFilters ? (
                          <button
                            type="button"
                            onClick={resetFilters}
                            className="px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                          >
                            Reset Filters
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={onNavigateRapidEntry}
                            className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
                          >
                            Open Rapid Cheque Entry
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredCheques.map((chq, idx) => {
                  const batch = batchMap.get(chq.batchId);
                  const depositAcc = bankMap.get(chq.companyBankAccountId);
                  const dateEval = evaluateChequeDate(
                    chq.chequeDate,
                    batch?.depositDate || '2026-11-17'
                  );
                  const isDup = Boolean(
                    findDuplicateCheque(cheques, chq.chequeNumber, chq.draweeBank, chq.id)
                  );
                  const isHighVal = chq.amount >= 200000;
                  const isRowLocked = Boolean(batch?.isLocked);

                  return (
                    <tr
                      key={chq.id}
                      className={`hover:bg-slate-50/80 transition-colors ${
                        dateEval.flag !== 'VALID' || isDup
                          ? 'bg-amber-50/35'
                          : ''
                      }`}
                    >
                      <td className="py-2.5 pl-4 pr-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select cheque ${chq.chequeNumber}`}
                          checked={selectedIds.includes(chq.id)}
                          onChange={() => toggleSelectOne(chq.id)}
                          className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                        />
                      </td>
                      <td className="py-2.5 px-2.5 align-top font-mono-num text-slate-500">
                        {String(idx + 1).padStart(2, '0')}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-mono-num font-medium text-slate-900 whitespace-nowrap">
                          {formatIndianDate(chq.chequeDate)}
                        </div>
                        <ComplianceIndicator
                          flag={dateEval.flag}
                          isDuplicate={isDup}
                          isHighValue={false}
                        />
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-mono-num font-semibold text-slate-900">
                          {chq.chequeNumber}
                        </div>
                        <div className="font-mono-num text-[11px] text-slate-500">
                          MICR {chq.micrCode}
                        </div>
                        {(chq.presentationCount ?? 1) > 1 && (
                          <div className="text-[10px] font-semibold text-indigo-700 mt-0.5">
                            {chq.presentationCount}
                            {chq.presentationCount === 2
                              ? 'nd'
                              : chq.presentationCount === 3
                              ? 'rd'
                              : 'th'}{' '}
                            Presentation
                          </div>
                        )}
                        {chq.replacesChequeNumber && (
                          <div className="text-[10px] font-medium text-emerald-700 mt-0.5 font-mono-num">
                            Replaces #{chq.replacesChequeNumber}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="font-medium text-slate-900">{chq.draweeBank}</div>
                        <div className="text-[11px] text-slate-500">{chq.draweeBranch}</div>
                      </td>
                      <td className="py-2.5 px-3 align-top max-w-[230px]">
                        {onOpenCustomerDocuments ? (
                          <button
                            type="button"
                            onClick={() =>
                              onOpenCustomerDocuments({
                                customerKey: getCustomerKey(
                                  chq.customerCode,
                                  chq.partyName
                                ),
                                linkChequeId: chq.id,
                              })
                            }
                            title={`Open Customer Profile & Documents for ${chq.partyName}`}
                            className="font-medium text-slate-900 hover:text-indigo-700 hover:underline truncate text-left block max-w-full"
                          >
                            {chq.partyName}
                          </button>
                        ) : (
                          <div
                            className="font-medium text-slate-900 truncate"
                            title={chq.partyName}
                          >
                            {chq.partyName}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-500 flex items-center gap-1.5 truncate">
                          <span className="font-mono-num">{chq.customerCode || '—'}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num">{chq.invoiceRef || '—'}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <div className="text-slate-900 font-medium whitespace-nowrap">
                          {chq.clearingType}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate max-w-[175px]">
                          {depositAcc
                            ? `${depositAcc.bankName.replace(' Ltd.', '')} · ${depositAcc.accountNumber.slice(-4)}`
                            : '—'}
                          {isHighVal ? ' · ≥₹2L' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top text-right">
                        <div className="font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                          {formatINR(chq.amount)}
                        </div>
                        {chq.status === 'Returned / Bounced' && chq.penaltyAmount ? (
                          <div className="font-mono-num text-[11px] text-red-700 whitespace-nowrap">
                            Penalty: {formatINR(chq.penaltyAmount)}
                          </div>
                        ) : null}
                        {(chq.recoveredAmount ?? 0) > 0 && (
                          <div className="font-mono-num text-[10px] text-emerald-700 whitespace-nowrap">
                            Paid: {formatINR(chq.recoveredAmount ?? 0)}
                            {(chq.recoveredAmount ?? 0) < chq.amount &&
                              ` · Bal: ${formatINR(
                                Math.max(0, chq.amount - (chq.recoveredAmount ?? 0))
                              )}`}
                          </div>
                        )}
                        {(chq.bounceChargesCollected ?? 0) > 0 && (
                          <div className="font-mono-num text-[10px] text-slate-600 whitespace-nowrap">
                            Chgs Coll: {formatINR(chq.bounceChargesCollected ?? 0)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top">
                        <select
                          aria-label={`Status for cheque ${chq.chequeNumber}`}
                          value={chq.status}
                          onChange={(e) => {
                            const nextStatus = e.target.value as ChequeStatus;
                            if (nextStatus === 'Returned / Bounced') {
                              setBounceTarget(chq);
                            } else {
                              onUpdateChequeStatus([chq.id], nextStatus);
                            }
                          }}
                          className={`px-2 py-1 text-[11px] font-semibold rounded border bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15 ${
                            chq.status === 'Cleared' ||
                            chq.status === 'Settled / Recovered'
                              ? 'border-emerald-300 text-emerald-800'
                              : chq.status === 'Re-Deposited'
                              ? 'border-indigo-300 text-indigo-800'
                              : chq.status === 'Submitted to Bank'
                              ? 'border-blue-300 text-blue-800'
                              : chq.status === 'Returned / Bounced'
                              ? 'border-red-300 text-red-800'
                              : 'border-slate-300 text-slate-700'
                          }`}
                        >
                          <option value="Draft">Draft</option>
                          <option value="Submitted to Bank">Submitted to Bank</option>
                          <option value="Cleared">Cleared</option>
                          <option value="Returned / Bounced">Returned / Bounced</option>
                          <option value="Settled / Recovered">Settled / Recovered</option>
                          <option value="Re-Deposited">Re-Deposited</option>
                        </select>
                        {chq.status === 'Returned / Bounced' && (
                          <div className="mt-1 space-y-1">
                            <button
                              type="button"
                              onClick={() => setBounceTarget(chq)}
                              title="Edit Reason of Return"
                              className="block text-left text-[11px] text-red-700 hover:text-red-900 underline decoration-dotted max-w-[165px] truncate"
                            >
                              {chq.bounceReason || 'Specify Reason of Return'}
                            </button>
                            {onExecuteRecoveryAction && (
                              <button
                                type="button"
                                onClick={() => setRecoveryTarget(chq)}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-white bg-[#0B192C] hover:bg-slate-800 rounded transition-colors whitespace-nowrap"
                              >
                                <Wallet className="w-2.5 h-2.5" aria-hidden="true" />
                                <span>Record Recovery / Action</span>
                              </button>
                            )}
                          </div>
                        )}
                        {chq.status === 'Settled / Recovered' && (
                          <div className="mt-1 space-y-0.5 text-[10px] text-slate-600">
                            <div className="font-mono-num truncate max-w-[165px]">
                              {chq.recoveryMode}
                              {chq.replacementChequeNumber
                                ? ` (#${chq.replacementChequeNumber})`
                                : chq.recoveryRef
                                ? ` (${chq.recoveryRef})`
                                : ''}
                            </div>
                            {(chq.recoveredAmount ?? 0) < chq.amount &&
                              onExecuteRecoveryAction && (
                                <button
                                  type="button"
                                  onClick={() => setRecoveryTarget(chq)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold text-amber-900 bg-amber-50 border border-amber-300 hover:bg-amber-100 rounded transition-colors whitespace-nowrap"
                                >
                                  <Wallet className="w-2.5 h-2.5" aria-hidden="true" />
                                  <span>Add Part Payment</span>
                                </button>
                              )}
                          </div>
                        )}
                        {chq.status === 'Re-Deposited' && chq.reDepositedToBatchRef && (
                          <div className="mt-1 text-[10px] font-mono-num text-indigo-700 truncate max-w-[165px]">
                            Moved → {chq.reDepositedToBatchRef}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 pl-3 pr-4 align-top text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          {(chq.status === 'Returned / Bounced' ||
                            (chq.status === 'Settled / Recovered' &&
                              (chq.recoveredAmount ?? 0) < chq.amount)) &&
                            onExecuteRecoveryAction && (
                              <button
                                type="button"
                                onClick={() => setRecoveryTarget(chq)}
                                title="Record Recovery / Action"
                                className="p-1.5 text-slate-700 hover:text-slate-950 hover:bg-slate-100 rounded transition-colors"
                              >
                                <Wallet className="w-3.5 h-3.5" />
                              </button>
                            )}
                          {chq.status === 'Draft' && (
                            <button
                              type="button"
                              onClick={() =>
                                onUpdateChequeStatus([chq.id], 'Submitted to Bank')
                              }
                              title="Mark Submitted to Bank"
                              className="p-1.5 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded transition-colors"
                            >
                              <Send className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {(chq.status === 'Draft' ||
                            chq.status === 'Submitted to Bank') && (
                            <button
                              type="button"
                              onClick={() => onUpdateChequeStatus([chq.id], 'Cleared')}
                              title="Mark Cleared"
                              className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded transition-colors"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {chq.status !== 'Returned / Bounced' &&
                            chq.status !== 'Settled / Recovered' &&
                            chq.status !== 'Re-Deposited' && (
                              <button
                                type="button"
                                onClick={() => setBounceTarget(chq)}
                                title="Record Return / Bounce"
                                className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </button>
                            )}
                          {onOpenCustomerDocuments && (() => {
                            const cKey = getCustomerKey(
                              chq.customerCode,
                              chq.partyName
                            );
                            const chqDocCount = documents.filter(
                              (d) =>
                                d.linkedChequeId === chq.id ||
                                (!d.linkedChequeId && d.customerKey === cKey)
                            ).length;
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  onOpenCustomerDocuments({
                                    customerKey: cKey,
                                    linkChequeId: chq.id,
                                  })
                                }
                                title="Customer Documents & Attachments"
                                className="inline-flex items-center gap-0.5 p-1.5 text-slate-500 hover:text-indigo-700 hover:bg-indigo-50 rounded transition-colors"
                              >
                                <Paperclip className="w-3.5 h-3.5" />
                                {chqDocCount > 0 && (
                                  <span className="text-[10px] font-mono-num font-semibold text-indigo-700">
                                    {chqDocCount}
                                  </span>
                                )}
                              </button>
                            );
                          })()}
                          <button
                            type="button"
                            onClick={() => setHistoryDrawerCheque(chq)}
                            title="View Cheque Activity History"
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                          >
                            <History className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onEditCheque(chq)}
                            title={
                              isRowLocked
                                ? 'Update Status (Core fields locked)'
                                : 'Edit Cheque'
                            }
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {isRowLocked ? (
                            <span
                              title="Batch locked: items cannot be deleted"
                              className="p-1.5 text-slate-300 cursor-not-allowed inline-flex items-center"
                            >
                              <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onDeleteCheque(chq.id)}
                              title="Delete Cheque"
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {filteredCheques.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50 text-xs font-semibold text-slate-900">
                  <td colSpan={7} className="py-3 px-4 text-right">
                    Schedule Total ({filteredCheques.length} Instruments):
                  </td>
                  <td className="py-3 px-3 text-right font-mono-num whitespace-nowrap">
                    {formatINR(kpis.totalAmount)}
                  </td>
                  <td colSpan={2} className="py-3 px-3 text-xs font-normal text-slate-500">
                    {formatIndianShort(kpis.totalAmount)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Bounce Reason & Penalty Modal */}
      {bounceTarget && (
        <BounceModal
          cheque={bounceTarget}
          onClose={() => setBounceTarget(null)}
          onConfirm={(data) => {
            onUpdateChequeStatus([bounceTarget.id], 'Returned / Bounced', data);
            setBounceTarget(null);
          }}
        />
      )}

      {/* Lock Batch / Maker-Checker Password Bypass Modal */}
      {lockModalMode && activeBatch && (
        <BatchLockModal
          mode={lockModalMode}
          batch={activeBatch}
          chequeCount={
            cheques.filter((c) => c.batchId === activeBatch.id).length
          }
          batchTotalAmount={cheques
            .filter((c) => c.batchId === activeBatch.id)
            .reduce((sum, c) => sum + c.amount, 0)}
          corporateCheckerPassword={corporateCheckerPassword}
          onClose={() => setLockModalMode(null)}
          onConfirmLock={(password, actorName) => {
            onLockBatch(activeBatch.id, password, actorName);
            setSelectedIds([]);
            setLockModalMode(null);
          }}
          onConfirmUnlock={(actorRole, actorName, reason) => {
            onUnlockBatch(activeBatch.id, actorRole, actorName, reason);
            setLockModalMode(null);
          }}
        />
      )}

      {/* Create New Daily Clearing Batch Modal */}
      {showNewBatchModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-lg shadow-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Create New Daily Clearing Batch
              </h3>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Deposit Date
                </label>
                <input
                  type="date"
                  value={newBatchDate}
                  onChange={(e) => setNewBatchDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Primary Deposit Bank Account
                </label>
                <select
                  value={newBatchBankId}
                  onChange={(e) => setNewBatchBankId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                >
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.bankName} — {acc.accountType} ({acc.accountNumber})
                    </option>
                  ))}
                </select>
              </div>
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-600 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <span>
                  A sequential FY batch reference (e.g. CLR/2026-27/NOV/0043) will be
                  assigned automatically.
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewBatchModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onCreateBatch(newBatchDate, newBatchBankId);
                  setShowNewBatchModal(false);
                }}
                className="px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                Create Batch
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Bank Statement Auto-Reconciliation Modal */}
      {showReconcileModal && (
        <BankStatementReconcileModal
          cheques={cheques}
          batches={batches}
          onConfirmReconcile={(updates, fileName) => {
            onReconcileReturnedCheques(updates, fileName);
            const clearedCount = updates.filter(
              (u) => u.matchType === 'CLEARED' || u.targetStatus === 'Cleared'
            ).length;
            const returnedCount = updates.length - clearedCount;
            setReconcileAlert({ clearedCount, returnedCount, fileName });
            setShowReconcileModal(false);
          }}
          onClose={() => setShowReconcileModal(false)}
        />
      )}

      {/* Cheque Activity History Slide-Over Drawer */}
      {historyDrawerCheque && (
        <ChequeActivityDrawer
          cheque={historyDrawerCheque}
          batch={batchMap.get(historyDrawerCheque.batchId)}
          logs={auditLogs.filter((l) => l.chequeId === historyDrawerCheque.id)}
          onClose={() => setHistoryDrawerCheque(null)}
        />
      )}

      {/* Re-Deposit & Replacement / Recovery Action Modal */}
      {recoveryTarget && onExecuteRecoveryAction && (
        <RecoveryActionModal
          cheque={recoveryTarget}
          batches={batches}
          bankAccounts={bankAccounts}
          activeBatchId={activeBatchId}
          onClose={() => setRecoveryTarget(null)}
          onSubmit={(submission) => {
            onExecuteRecoveryAction(recoveryTarget.id, submission);
            const msg =
              submission.choice === 'RE_PRESENT'
                ? `Cheque #${recoveryTarget.chequeNumber} moved to Re-Deposit (${
                    (recoveryTarget.presentationCount || 1) + 1
                  }nd-time presentation).`
                : submission.choice === 'REPLACEMENT_CHEQUE'
                ? `Replacement cheque #${submission.newChequeNumber} saved and #${recoveryTarget.chequeNumber} marked Settled / Recovered.`
                : `Recovery payment of ${formatINR(
                    submission.receivedAmount
                  )} saved for cheque #${recoveryTarget.chequeNumber}.`;
            setRecoveryNotice(msg);
            setRecoveryTarget(null);
          }}
        />
      )}
    </div>
  );
}
