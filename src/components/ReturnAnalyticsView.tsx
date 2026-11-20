import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  FileCheck2,
  FileSpreadsheet,
  History,
  Landmark,
  Printer,
  RotateCcw,
  Search,
  Wallet,
  X,
} from 'lucide-react';
import {
  BankCollectionStatus,
  ChequeEntry,
  CompanyWorkspace,
  RecoveryStatus,
  SystemAuditLogEntry,
} from '../types/treasury';
import { ChequeActivityDrawer } from './ActivityTimeline';
import {
  RecoveryActionModal,
  RecoveryActionSubmission,
} from './RecoveryActionModal';
import {
  formatIndianDate,
  formatIndianShort,
  formatINR,
} from '../utils/indianCurrency';
import {
  exportReturnedChequesToExcel,
  ReturnedChequeExportItem,
} from '../utils/excelExport';
import {
  generateBankCollectionChecklistPDF,
  groupUncollectedByBankBranch,
} from '../utils/pdfCollectionChecklistGenerator';
import {
  formatExactElapsedDuration,
  getElapsedSinceReturnMs,
  getGraceRemainingMs,
  isReturnedChequeOverdue,
} from '../utils/returnedChequeAlerts';

export interface ChequeRecoveryPatch {
  bankCollectionStatus?: BankCollectionStatus;
  collectedFromBankDate?: string;
  collectedBy?: string;
  recoveryStatus?: RecoveryStatus;
  recoveredAmount?: number;
  recoveryDate?: string;
  recoveryMode?: string;
  recoveryRef?: string;
  remarks?: string;
}

export interface ChecklistFocusTarget {
  companyId: string;
  chequeId: string;
  requestedAt: number;
}

interface ReturnAnalyticsViewProps {
  companies: CompanyWorkspace[];
  activeCompany: CompanyWorkspace;
  auditLogs?: SystemAuditLogEntry[];
  checklistFocusTarget?: ChecklistFocusTarget | null;
  onClearChecklistFocusTarget?: () => void;
  onUpdateChequeRecovery: (
    companyId: string,
    chequeId: string,
    patch: ChequeRecoveryPatch
  ) => void;
  onExecuteRecoveryAction?: (
    companyId: string,
    chequeId: string,
    submission: RecoveryActionSubmission
  ) => void;
  onNavigateReturnAck: () => void;
}

interface EnrichedReturnedRow {
  companyId: string;
  companyName: string;
  companyPan: string;
  batchRef: string;
  depositBank: string;
  depositBranch: string;
  depositIfsc: string;
  depositAccount: string;
  cheque: ChequeEntry;
  recoveredAmount: number;
  unrecoveredAmount: number;
  collectionStatus: BankCollectionStatus;
  recoveryStatus: RecoveryStatus;
}

function getMonthKey(dateStr?: string): string {
  if (!dateStr || dateStr.length < 7) return 'Unknown';
  return dateStr.slice(0, 7); // YYYY-MM
}

function formatMonthLabel(monthKey: string): string {
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey;
  const [y, m] = monthKey.split('-');
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const idx = Number(m) - 1;
  return `${names[idx] || m} ${y.slice(2)}`;
}

function normalizeReasonLabel(raw?: string): string {
  const clean = (raw || '').trim();
  if (!clean) return 'Reason Not Specified';
  return clean;
}

export function ReturnAnalyticsView({
  companies,
  activeCompany,
  auditLogs = [],
  checklistFocusTarget = null,
  onClearChecklistFocusTarget,
  onUpdateChequeRecovery,
  onExecuteRecoveryAction,
  onNavigateReturnAck,
}: ReturnAnalyticsViewProps) {
  const [activeTab, setActiveTab] = useState<'analytics' | 'checklist'>(
    'analytics'
  );
  const [companyScope, setCompanyScope] = useState<'active' | 'all'>('active');
  const [historyDrawerCheque, setHistoryDrawerCheque] =
    useState<ChequeEntry | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [focusedChecklistChequeId, setFocusedChecklistChequeId] = useState<
    string | null
  >(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!checklistFocusTarget) return;
    setActiveTab('checklist');
    if (
      checklistFocusTarget.companyId !== activeCompany.id &&
      companies.length > 1
    ) {
      setCompanyScope('all');
    }
    setFocusedChecklistChequeId(checklistFocusTarget.chequeId);
    const scrollTimer = window.setTimeout(() => {
      const el = document.querySelector(
        `[data-checklist-cheque-id="${checklistFocusTarget.chequeId}"]`
      );
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      onClearChecklistFocusTarget?.();
    }, 120);
    return () => window.clearTimeout(scrollTimer);
  }, [checklistFocusTarget, activeCompany.id, companies.length, onClearChecklistFocusTarget]);

  // Filters for Analytics & Returned Ledger
  const [searchQuery, setSearchQuery] = useState('');
  const [reasonFilter, setReasonFilter] = useState<string>('ALL');
  const [partyFilter, setPartyFilter] = useState<string>('ALL');
  const [collectionFilter, setCollectionFilter] = useState<string>('ALL');
  const [recoveryFilter, setRecoveryFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Action feedback states
  const [excelNotice, setExcelNotice] = useState<string | null>(null);
  const [pdfNotice, setPdfNotice] = useState<{
    filename: string;
    blobUrl: string;
  } | null>(null);
  const [recoveryModalTarget, setRecoveryModalTarget] =
    useState<EnrichedReturnedRow | null>(null);

  const scopedCompanies = useMemo(
    () => (companyScope === 'all' ? companies : [activeCompany]),
    [companyScope, companies, activeCompany]
  );

  // Build all returned cheques (including Settled / Recovered & Re-Deposited) across the selected company scope
  const allReturnedRows: EnrichedReturnedRow[] = useMemo(() => {
    const rows: EnrichedReturnedRow[] = [];

    for (const comp of scopedCompanies) {
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
        const batch = batchMap.get(chq.batchId);
        const bank =
          bankMap.get(chq.companyBankAccountId) || comp.bankAccounts[0];
        const isRedeposited = chq.status === 'Re-Deposited';
        const recovered = isRedeposited
          ? 0
          : Math.min(chq.amount, Math.max(0, chq.recoveredAmount ?? 0));
        const unrecovered = isRedeposited
          ? 0
          : Math.max(0, chq.amount - recovered);
        const collectionStatus: BankCollectionStatus =
          chq.bankCollectionStatus || 'Pending Collection';
        const recoveryStatus: RecoveryStatus =
          chq.recoveryStatus ||
          (recovered >= chq.amount && chq.amount > 0
            ? 'Recovered / Settled'
            : recovered > 0
            ? 'Partially Recovered'
            : 'Unrecovered');

        rows.push({
          companyId: comp.id,
          companyName: comp.profile.companyName,
          companyPan: comp.profile.pan,
          batchRef: batch?.batchRef || '—',
          depositBank: bank?.bankName || 'Deposit Bank',
          depositBranch: bank?.branchName || 'Main Branch',
          depositIfsc: bank?.ifscCode || '—',
          depositAccount: bank?.accountNumber || '—',
          cheque: chq,
          recoveredAmount: recovered,
          unrecoveredAmount: unrecovered,
          collectionStatus,
          recoveryStatus,
        });
      }
    }

    return rows.sort((a, b) => {
      const da = a.cheque.bouncedDate || a.cheque.chequeDate;
      const db = b.cheque.bouncedDate || b.cheque.chequeDate;
      return db.localeCompare(da);
    });
  }, [scopedCompanies]);

  const uniqueReasons = useMemo(() => {
    const set = new Set<string>();
    allReturnedRows.forEach((r) =>
      set.add(normalizeReasonLabel(r.cheque.bounceReason))
    );
    return Array.from(set).sort();
  }, [allReturnedRows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allReturnedRows.filter((row) => {
      const reason = normalizeReasonLabel(row.cheque.bounceReason);
      if (reasonFilter !== 'ALL' && reason !== reasonFilter) return false;
      if (
        partyFilter !== 'ALL' &&
        (row.cheque.partyName || '').trim().toLowerCase() !==
          partyFilter.trim().toLowerCase()
      )
        return false;
      if (
        collectionFilter !== 'ALL' &&
        row.collectionStatus !== collectionFilter
      )
        return false;
      if (recoveryFilter !== 'ALL' && row.recoveryStatus !== recoveryFilter)
        return false;

      const effectiveDate = row.cheque.bouncedDate || row.cheque.chequeDate;
      if (dateFrom && effectiveDate < dateFrom) return false;
      if (dateTo && effectiveDate > dateTo) return false;

      if (q) {
        const hay = `${row.cheque.chequeNumber} ${row.cheque.partyName} ${row.cheque.draweeBank} ${row.depositBank} ${row.batchRef} ${row.companyName} ${reason} ${row.cheque.recoveryRef || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    allReturnedRows,
    reasonFilter,
    partyFilter,
    collectionFilter,
    recoveryFilter,
    dateFrom,
    dateTo,
    searchQuery,
  ]);

  const hasFilters =
    Boolean(searchQuery) ||
    reasonFilter !== 'ALL' ||
    partyFilter !== 'ALL' ||
    collectionFilter !== 'ALL' ||
    recoveryFilter !== 'ALL' ||
    Boolean(dateFrom) ||
    Boolean(dateTo);

  const resetFilters = () => {
    setSearchQuery('');
    setReasonFilter('ALL');
    setPartyFilter('ALL');
    setCollectionFilter('ALL');
    setRecoveryFilter('ALL');
    setDateFrom('');
    setDateTo('');
  };

  // KPI Metrics (computed over filteredRows so charts & KPIs react immediately to filters)
  const kpis = useMemo(() => {
    let totalCount = filteredRows.length;
    let totalValue = 0;
    let pendingCollectionCount = 0;
    let pendingCollectionValue = 0;
    let overdueCount = 0;
    let recoveredAmount = 0;
    let settledCount = 0;
    let unrecoveredBalance = 0;
    let unrecoveredCount = 0;

    for (const r of filteredRows) {
      totalValue += r.cheque.amount;
      recoveredAmount += r.recoveredAmount;
      unrecoveredBalance += r.unrecoveredAmount;
      if (
        r.cheque.status === 'Returned / Bounced' &&
        r.collectionStatus === 'Pending Collection'
      ) {
        pendingCollectionCount += 1;
        pendingCollectionValue += r.cheque.amount;
        if (isReturnedChequeOverdue(r.cheque, nowMs)) {
          overdueCount += 1;
        }
      }
      if (r.recoveryStatus === 'Recovered / Settled') {
        settledCount += 1;
      }
      if (r.unrecoveredAmount > 0) {
        unrecoveredCount += 1;
      }
    }

    const recoveryPct =
      totalValue > 0 ? Math.round((recoveredAmount / totalValue) * 100) : 0;

    return {
      totalCount,
      totalValue,
      pendingCollectionCount,
      pendingCollectionValue,
      overdueCount,
      recoveredAmount,
      settledCount,
      recoveryPct,
      unrecoveredBalance,
      unrecoveredCount,
    };
  }, [filteredRows, nowMs]);

  // Chart 1: Top Return Reasons
  const topReasons = useMemo(() => {
    const map = new Map<
      string,
      { reason: string; count: number; amount: number }
    >();
    for (const r of allReturnedRows) {
      const key = normalizeReasonLabel(r.cheque.bounceReason);
      const cur = map.get(key) || { reason: key, count: 0, amount: 0 };
      cur.count += 1;
      cur.amount += r.cheque.amount;
      map.set(key, cur);
    }
    const list = Array.from(map.values()).sort(
      (a, b) => b.count - a.count || b.amount - a.amount
    );
    const maxCount = Math.max(1, ...list.map((i) => i.count));
    return list.slice(0, 6).map((item) => ({
      ...item,
      pctOfTotal:
        allReturnedRows.length > 0
          ? Math.round((item.count / allReturnedRows.length) * 100)
          : 0,
      barWidth: Math.max(8, Math.round((item.count / maxCount) * 100)),
    }));
  }, [allReturnedRows]);

  // Chart 2: Repeat Defaulters (Parties with highest returned cheque count & value)
  const repeatDefaulters = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const baseRows = allReturnedRows.filter((row) => {
      const reason = normalizeReasonLabel(row.cheque.bounceReason);
      if (reasonFilter !== 'ALL' && reason !== reasonFilter) return false;
      if (
        collectionFilter !== 'ALL' &&
        row.collectionStatus !== collectionFilter
      )
        return false;
      if (recoveryFilter !== 'ALL' && row.recoveryStatus !== recoveryFilter)
        return false;

      const effectiveDate = row.cheque.bouncedDate || row.cheque.chequeDate;
      if (dateFrom && effectiveDate < dateFrom) return false;
      if (dateTo && effectiveDate > dateTo) return false;

      if (q) {
        const hay = `${row.cheque.chequeNumber} ${row.cheque.partyName} ${row.cheque.draweeBank} ${row.depositBank} ${row.batchRef} ${row.companyName} ${reason} ${row.cheque.recoveryRef || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const map = new Map<
      string,
      {
        partyName: string;
        customerCode: string;
        count: number;
        totalAmount: number;
        unrecoveredAmount: number;
      }
    >();
    for (const r of baseRows) {
      const displayName = (r.cheque.partyName || 'Unknown Party').trim() || 'Unknown Party';
      const key = displayName.toLowerCase();
      const cur = map.get(key) || {
        partyName: displayName,
        customerCode: r.cheque.customerCode,
        count: 0,
        totalAmount: 0,
        unrecoveredAmount: 0,
      };
      cur.count += 1;
      cur.totalAmount += Number(r.cheque.amount) || 0;
      cur.unrecoveredAmount += Number(r.unrecoveredAmount) || 0;
      if (!cur.customerCode && r.cheque.customerCode) {
        cur.customerCode = r.cheque.customerCode;
      }
      map.set(key, cur);
    }
    const list = Array.from(map.values()).sort(
      (a, b) => b.count - a.count || b.totalAmount - a.totalAmount
    );
    const maxCount = Math.max(1, ...list.map((i) => i.count));
    const maxAmt = Math.max(0, ...list.map((i) => i.totalAmount));
    return list.slice(0, 6).map((item) => {
      const countBarWidth = Math.max(
        10,
        Math.round((item.count / maxCount) * 100)
      );
      const amtBarWidth =
        maxAmt > 0
          ? Math.max(10, Math.round((item.totalAmount / maxAmt) * 100))
          : countBarWidth;
      return {
        ...item,
        countBarWidth,
        amtBarWidth,
      };
    });
  }, [
    allReturnedRows,
    reasonFilter,
    collectionFilter,
    recoveryFilter,
    dateFrom,
    dateTo,
    searchQuery,
  ]);

  // Chart 3: Monthly Return Trend (Volume & Value by Month)
  const monthlyTrend = useMemo(() => {
    const map = new Map<
      string,
      { monthKey: string; label: string; count: number; amount: number }
    >();
    for (const r of allReturnedRows) {
      const dt = r.cheque.bouncedDate || r.cheque.chequeDate;
      const key = getMonthKey(dt);
      const cur = map.get(key) || {
        monthKey: key,
        label: formatMonthLabel(key),
        count: 0,
        amount: 0,
      };
      cur.count += 1;
      cur.amount += r.cheque.amount;
      map.set(key, cur);
    }
    const sorted = Array.from(map.values()).sort((a, b) =>
      a.monthKey.localeCompare(b.monthKey)
    );
    const maxAmount = Math.max(1, ...sorted.map((m) => m.amount));
    const maxCount = Math.max(1, ...sorted.map((m) => m.count));
    return sorted.map((m) => ({
      ...m,
      amountHeightPct: Math.max(12, Math.round((m.amount / maxAmount) * 100)),
      countHeightPct: Math.max(12, Math.round((m.count / maxCount) * 100)),
    }));
  }, [allReturnedRows]);

  // Bank Collection Checklist Groups (Uncollected returned cheques grouped by Bank Name & Branch)
  const checklistGroups = useMemo(
    () => groupUncollectedByBankBranch(scopedCompanies),
    [scopedCompanies]
  );

  const checklistTotals = useMemo(() => {
    const count = checklistGroups.reduce((s, g) => s + g.items.length, 0);
    const amount = checklistGroups.reduce((s, g) => s + g.totalAmount, 0);
    const overdueCount = checklistGroups.reduce(
      (s, g) =>
        s +
        g.items.filter((item) => isReturnedChequeOverdue(item.cheque, nowMs))
          .length,
      0
    );
    return { branchCount: checklistGroups.length, count, amount, overdueCount };
  }, [checklistGroups, nowMs]);

  const handleExportExcel = () => {
    const exportItems: ReturnedChequeExportItem[] = filteredRows.map((r) => ({
      companyName: r.companyName,
      companyPan: r.companyPan,
      batchRef: r.batchRef,
      depositBank: r.depositBank,
      depositBranch: r.depositBranch,
      cheque: r.cheque,
    }));
    const filename = exportReturnedChequesToExcel(exportItems);
    setExcelNotice(filename);
    setTimeout(() => setExcelNotice(null), 5000);
  };

  const handleDownloadChecklistPdf = () => {
    if (checklistGroups.length === 0) return;
    if (pdfNotice?.blobUrl) {
      URL.revokeObjectURL(pdfNotice.blobUrl);
    }
    const companyLabel =
      companyScope === 'all'
        ? `Consolidated (${companies.length} Companies)`
        : activeCompany.profile.companyName;
    const result = generateBankCollectionChecklistPDF({
      companyLabel,
      groups: checklistGroups,
      generatedDate: new Date().toISOString().slice(0, 10),
    });
    setPdfNotice(result);
  };

  const handleQuickToggleCollection = (row: EnrichedReturnedRow) => {
    const today = new Date().toISOString().slice(0, 10);
    const nextStatus: BankCollectionStatus =
      row.collectionStatus === 'Pending Collection'
        ? 'Collected from Bank'
        : 'Pending Collection';
    onUpdateChequeRecovery(row.companyId, row.cheque.id, {
      bankCollectionStatus: nextStatus,
      collectedFromBankDate:
        nextStatus === 'Collected from Bank' ? today : undefined,
    });
  };

  const openRecoveryModal = (row: EnrichedReturnedRow) => {
    setRecoveryModalTarget(row);
  };

  return (
    <div className="space-y-6">
      {/* Top Action & View Switcher Toolbar (Hidden in Print) */}
      <section className="no-print bg-white border border-[#D9E2EC] rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex p-0.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md">
            <button
              type="button"
              onClick={() => setActiveTab('analytics')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'analytics'
                  ? 'bg-white text-[#102A43] font-semibold shadow-xs'
                  : 'text-[#627D98] hover:text-[#102A43]'
              }`}
            >
              <BarChart3 className={`w-3.5 h-3.5 ${activeTab === 'analytics' ? 'text-[#176B87]' : ''}`} aria-hidden="true" />
              <span>Analytics &amp; Recovery</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('checklist')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'checklist'
                  ? 'bg-white text-[#102A43] font-semibold shadow-xs'
                  : 'text-[#627D98] hover:text-[#102A43]'
              }`}
            >
              <ClipboardCheck className={`w-3.5 h-3.5 ${activeTab === 'checklist' ? 'text-[#176B87]' : ''}`} aria-hidden="true" />
              <span>
                Bank Collection Checklist ({checklistTotals.count})
              </span>
              {checklistTotals.overdueCount > 0 && (
                <span className="overdue-blink-badge inline-flex items-center px-1.5 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold font-mono-num">
                  {checklistTotals.overdueCount} Overdue
                </span>
              )}
            </button>
          </div>

          {companies.length > 1 && (
            <div className="flex p-0.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md">
              <button
                type="button"
                onClick={() => setCompanyScope('active')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  companyScope === 'active'
                    ? 'bg-white text-[#102A43] font-semibold shadow-xs'
                    : 'text-[#627D98] hover:text-[#102A43]'
                }`}
              >
                Active Company
              </button>
              <button
                type="button"
                onClick={() => setCompanyScope('all')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  companyScope === 'all'
                    ? 'bg-white text-[#102A43] font-semibold shadow-xs'
                    : 'text-[#627D98] hover:text-[#102A43]'
                }`}
              >
                All Companies ({companies.length})
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {allReturnedRows.length > 0 && (
            <button
              type="button"
              onClick={onNavigateReturnAck}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#DC2626] bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-md hover:bg-[#DC2626]/15 transition-colors whitespace-nowrap shrink-0"
            >
              <FileCheck2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Return Acknowledgement Letter</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={filteredRows.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#176B87] rounded-md hover:bg-[#102A43] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export to Excel (.xlsx)</span>
          </button>
        </div>
      </section>

      {excelNotice && (
        <div
          role="status"
          className="no-print px-4 py-2.5 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md text-xs text-[#102A43] flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>
              Excel report exported:{' '}
              <strong className="font-mono-num">{excelNotice}</strong> (
              {filteredRows.length} returned cheque record
              {filteredRows.length === 1 ? '' : 's'}).
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExcelNotice(null)}
            className="p-1 text-[#16A34A] hover:text-[#102A43]"
            aria-label="Dismiss export notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {activeTab === 'analytics' ? (
        <>
          {/* 1. Summary KPI Cards */}
          <section
            aria-label="Returned Cheques Summary KPIs"
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 bg-white border border-[#D9E2EC] rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-[#D9E2EC] shadow-xs"
          >
            <div className="p-5">
              <div className="text-xs font-medium text-[#627D98]">
                Total Returned Cheques
              </div>
              <div className="mt-1.5 text-2xl font-bold tracking-tight text-[#102A43] font-mono-num">
                {formatINR(kpis.totalValue)}
              </div>
              <div className="mt-1.5 text-xs text-[#627D98] flex items-center gap-2">
                <span className="font-semibold text-[#DC2626] font-mono-num">
                  {kpis.totalCount} Cheques
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatIndianShort(kpis.totalValue)}</span>
              </div>
            </div>

            <div className="p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-medium text-[#627D98]">
                  Pending Bank Collection
                </div>
                {kpis.overdueCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('checklist')}
                    className="overdue-blink-badge inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold"
                  >
                    <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                    <span>{kpis.overdueCount} (12+ Hrs Overdue)</span>
                  </button>
                )}
              </div>
              <div
                className={`mt-1.5 text-2xl font-bold tracking-tight font-mono-num ${
                  kpis.overdueCount > 0 ? 'text-[#DC2626]' : 'text-[#B45309]'
                }`}
              >
                {formatINR(kpis.pendingCollectionValue)}
              </div>
              <div className="mt-1.5 text-xs text-[#627D98] flex items-center gap-2">
                <span className="font-semibold text-[#102A43] font-mono-num">
                  {kpis.pendingCollectionCount} Uncollected
                </span>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => setActiveTab('checklist')}
                  className="font-medium text-[#176B87] underline hover:text-[#102A43]"
                >
                  Open Checklist
                </button>
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs font-medium text-[#627D98]">
                Recovered / Settled Amount
              </div>
              <div className="mt-1.5 text-2xl font-bold tracking-tight text-[#16A34A] font-mono-num">
                {formatINR(kpis.recoveredAmount)}
              </div>
              <div className="mt-1.5 text-xs text-[#627D98] flex items-center gap-2">
                <span className="font-semibold text-[#16A34A] font-mono-num">
                  {kpis.recoveryPct}% Recovery
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num">
                  {kpis.settledCount} Settled
                </span>
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs font-medium text-[#627D98]">
                Unrecovered Balance
              </div>
              <div className="mt-1.5 text-2xl font-bold tracking-tight text-[#DC2626] font-mono-num">
                {formatINR(kpis.unrecoveredBalance)}
              </div>
              <div className="mt-1.5 text-xs text-[#627D98] flex items-center gap-2">
                <span className="font-semibold text-[#102A43] font-mono-num">
                  {kpis.unrecoveredCount} Open Receivables
                </span>
                <span aria-hidden="true">·</span>
                <span>{formatIndianShort(kpis.unrecoveredBalance)}</span>
              </div>
            </div>
          </section>

          {/* 2. Three Visual Analytics Charts */}
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Chart 1: Top Return Reasons */}
            <div className="bg-white border border-[#D9E2EC] rounded-lg p-5 flex flex-col shadow-xs">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#D9E2EC]">
                <div>
                  <h2 className="text-sm font-semibold text-[#102A43]">
                    Top Return Reasons
                  </h2>
                  <p className="text-xs text-[#627D98]">
                    Dishonour breakdown by bank memo reason
                  </p>
                </div>
                {reasonFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setReasonFilter('ALL')}
                    className="text-[11px] font-medium text-[#176B87] hover:text-[#102A43] underline"
                  >
                    Clear
                  </button>
                )}
              </div>

              {topReasons.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-10 text-xs text-[#627D98]">
                  No returned cheques recorded yet.
                </div>
              ) : (
                <div className="pt-4 space-y-3.5 flex-1">
                  {topReasons.map((item) => {
                    const isSelected = reasonFilter === item.reason;
                    return (
                      <button
                        key={item.reason}
                        type="button"
                        onClick={() =>
                          setReasonFilter(isSelected ? 'ALL' : item.reason)
                        }
                        className={`w-full text-left space-y-1.5 rounded p-1.5 -mx-1.5 transition-colors ${
                          isSelected ? 'bg-[#14B8A6]/10' : 'hover:bg-[#F4F7FA]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-[#243B53] truncate">
                            {item.reason}
                          </span>
                          <span className="font-mono-num text-[#627D98] shrink-0">
                            <strong className="text-[#102A43]">
                              {item.count}
                            </strong>{' '}
                            ({item.pctOfTotal}%) ·{' '}
                            {formatIndianShort(item.amount)}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-[#F4F7FA] rounded-sm overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              isSelected ? 'bg-[#102A43]' : 'bg-[#DC2626]'
                            }`}
                            style={{ width: `${item.barWidth}%` }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chart 2: Repeat Defaulters */}
            <div className="bg-white border border-[#D9E2EC] rounded-lg p-5 flex flex-col shadow-xs">
              <div className="flex items-start justify-between gap-2 pb-3 border-b border-[#D9E2EC]">
                <div>
                  <h2 className="text-sm font-semibold text-[#102A43]">
                    Repeat Defaulters
                  </h2>
                  <p className="text-xs text-[#627D98]">
                    Parties ranked by returned cheque count &amp; exposure
                  </p>
                </div>
                {partyFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setPartyFilter('ALL')}
                    className="text-[11px] font-medium text-[#176B87] hover:text-[#102A43] underline"
                  >
                    Clear
                  </button>
                )}
              </div>

              {repeatDefaulters.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-10 text-xs text-[#627D98]">
                  {allReturnedRows.length === 0
                    ? 'No customer return history recorded yet.'
                    : 'No repeat defaulters match the current filters.'}
                </div>
              ) : (
                <div className="pt-4 space-y-3.5 flex-1">
                  {repeatDefaulters.map((party) => {
                    const isSelected =
                      partyFilter !== 'ALL' &&
                      partyFilter.trim().toLowerCase() ===
                        party.partyName.trim().toLowerCase();
                    return (
                      <button
                        key={party.partyName}
                        type="button"
                        onClick={() =>
                          setPartyFilter(isSelected ? 'ALL' : party.partyName)
                        }
                        className={`w-full text-left space-y-1.5 rounded p-1.5 -mx-1.5 transition-colors ${
                          isSelected ? 'bg-[#14B8A6]/10' : 'hover:bg-[#F4F7FA]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-[#102A43] truncate">
                            {party.partyName}
                          </span>
                          <span className="font-mono-num text-[#627D98] shrink-0">
                            <strong className="text-[#102A43]">
                              {party.count} chq{party.count === 1 ? '' : 's'}
                            </strong>{' '}
                            · {formatIndianShort(party.totalAmount)}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-[#F4F7FA] rounded-sm overflow-hidden">
                          <div
                            className={`h-full transition-all ${
                              isSelected ? 'bg-[#DC2626]' : 'bg-[#176B87]'
                            }`}
                            style={{ width: `${party.amtBarWidth}%` }}
                          />
                        </div>
                        <div className="text-[11px] text-[#627D98] font-mono-num flex justify-between">
                          <span>{party.customerCode || 'Customer'}</span>
                          <span>
                            Unrecovered: {formatINR(party.unrecoveredAmount)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Chart 3: Monthly Return Trend */}
            <div className="bg-white border border-[#D9E2EC] rounded-lg p-5 flex flex-col shadow-xs">
              <div className="pb-3 border-b border-[#D9E2EC]">
                <h2 className="text-sm font-semibold text-[#102A43]">
                  Monthly Return Trend
                </h2>
                <p className="text-xs text-[#627D98]">
                  Returned cheque volume &amp; value by month
                </p>
              </div>

              {monthlyTrend.length === 0 ? (
                <div className="flex-1 flex items-center justify-center py-10 text-xs text-[#627D98]">
                  No monthly return data available yet.
                </div>
              ) : (
                <div className="pt-5 flex-1 flex flex-col justify-between gap-4">
                  {/* Visual Column Chart */}
                  <div className="h-44 flex items-end gap-3 px-2 pt-4 pb-1 border-b border-[#D9E2EC]">
                    {monthlyTrend.map((m) => (
                      <div
                        key={m.monthKey}
                        className="flex-1 flex flex-col items-center justify-end h-full min-w-[38px]"
                      >
                        <div className="text-[10px] font-mono-num font-semibold text-[#102A43] mb-1">
                          {m.count}
                        </div>
                        <div
                          className="w-full max-w-[34px] bg-[#102A43] hover:bg-[#14B8A6] rounded-t-sm transition-all"
                          style={{ height: `${m.amountHeightPct}%` }}
                          title={`${m.label}: ${m.count} cheque(s), ${formatINR(m.amount)}`}
                        />
                      </div>
                    ))}
                  </div>

                  {/* Month X-Axis + Values */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3 px-2 text-center">
                      {monthlyTrend.map((m) => (
                        <div
                          key={`${m.monthKey}-lbl`}
                          className="flex-1 min-w-[38px]"
                        >
                          <div className="text-[11px] font-medium text-[#243B53]">
                            {m.label}
                          </div>
                          <div className="text-[10px] font-mono-num text-[#627D98]">
                            {formatIndianShort(m.amount)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 3. Filtered Returned Cheques List + Excel Export + Recovery Actions */}
          <section className="bg-white border border-[#D9E2EC] rounded-lg overflow-hidden shadow-xs">
            <div className="p-4 border-b border-[#D9E2EC] space-y-3">
              <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5 flex-1">
                  <div className="relative min-w-[220px] flex-1 max-w-sm">
                    <Search
                      className="w-3.5 h-3.5 text-[#627D98] absolute left-3 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search cheque #, party, bank, batch, ref..."
                      className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    />
                  </div>

                  <select
                    aria-label="Filter by return reason"
                    value={reasonFilter}
                    onChange={(e) => setReasonFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  >
                    <option value="ALL">All Return Reasons</option>
                    {uniqueReasons.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter by bank collection status"
                    value={collectionFilter}
                    onChange={(e) => setCollectionFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  >
                    <option value="ALL">All Collection States</option>
                    <option value="Pending Collection">
                      Pending Bank Collection
                    </option>
                    <option value="Collected from Bank">
                      Collected from Bank
                    </option>
                  </select>

                  <select
                    aria-label="Filter by recovery status"
                    value={recoveryFilter}
                    onChange={(e) => setRecoveryFilter(e.target.value)}
                    className="px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  >
                    <option value="ALL">All Recovery States</option>
                    <option value="Unrecovered">Unrecovered</option>
                    <option value="Partially Recovered">
                      Partially Recovered
                    </option>
                    <option value="Recovered / Settled">
                      Recovered / Settled
                    </option>
                  </select>

                  <div className="flex items-center gap-1.5 text-xs text-[#627D98]">
                    <span>From:</span>
                    <input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="px-2 py-1 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    />
                    <span>To:</span>
                    <input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="px-2 py-1 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    />
                  </div>

                  {hasFilters && (
                    <button
                      type="button"
                      onClick={resetFilters}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#627D98] hover:text-[#102A43]"
                    >
                      <RotateCcw className="w-3 h-3" aria-hidden="true" />
                      <span>Reset</span>
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleExportExcel}
                  disabled={filteredRows.length === 0}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
                  <span>Export to Excel (.xlsx)</span>
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#D9E2EC] bg-[#F4F7FA] text-[11px] font-semibold text-[#627D98]">
                    <th className="py-2.5 px-4">Cheque / Date</th>
                    <th className="py-2.5 px-3">Customer / Batch</th>
                    <th className="py-2.5 px-3">Deposit &amp; Drawee Bank</th>
                    <th className="py-2.5 px-3">Return Reason</th>
                    <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                    <th className="py-2.5 px-3">Bank Collection</th>
                    <th className="py-2.5 px-3">Recovery &amp; Balance</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D9E2EC] text-xs">
                  {filteredRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 px-4 text-center text-[#627D98]"
                      >
                        No returned cheques match the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredRows.map((row) => {
                      const isOverdue = isReturnedChequeOverdue(row.cheque, nowMs);
                      const elapsedMs = getElapsedSinceReturnMs(row.cheque, nowMs);
                      const graceRemainingMs = getGraceRemainingMs(
                        row.cheque,
                        nowMs
                      );
                      return (
                      <tr
                        key={`${row.companyId}-${row.cheque.id}`}
                        className={`transition-colors ${
                          isOverdue
                            ? 'bg-[#DC2626]/8 hover:bg-[#DC2626]/12 border-l-4 border-l-[#DC2626]'
                            : 'hover:bg-[#F4F7FA]/80'
                        }`}
                      >
                        <td className="py-3 px-4 whitespace-nowrap">
                          <div className="font-mono-num font-bold text-[#176B87]">
                            #{row.cheque.chequeNumber}
                          </div>
                          <div className="text-[11px] font-mono-num text-[#627D98]">
                            Chq: {formatIndianDate(row.cheque.chequeDate)}
                          </div>
                          {row.cheque.bouncedDate && (
                            <div className="text-[10px] font-mono-num text-[#DC2626]">
                              Ret: {formatIndianDate(row.cheque.bouncedDate)}
                            </div>
                          )}
                          {isOverdue && (
                            <span className="mt-1 overdue-blink-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold">
                              <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                              <span>12+ Hrs Overdue</span>
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-3 min-w-[200px]">
                          <div className="font-semibold text-[#102A43]">
                            {row.cheque.partyName}
                          </div>
                          <div className="text-[11px] text-[#627D98] font-mono-num">
                            {row.batchRef}
                            {companyScope === 'all' && ` · ${row.companyName}`}
                          </div>
                        </td>

                        <td className="py-3 px-3 min-w-[180px]">
                          <div className="font-medium text-[#243B53]">
                            {row.depositBank}
                          </div>
                          <div className="text-[11px] text-[#627D98]">
                            {row.depositBranch}
                          </div>
                          <div className="text-[10px] text-[#627D98]">
                            Drawn: {row.cheque.draweeBank}
                          </div>
                        </td>

                        <td className="py-3 px-3 min-w-[170px]">
                          <div className="font-medium text-[#DC2626]">
                            {normalizeReasonLabel(row.cheque.bounceReason)}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right font-mono-num font-bold text-[#102A43] whitespace-nowrap">
                          {formatINR(row.cheque.amount)}
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleQuickToggleCollection(row)}
                            className={`text-left text-xs font-semibold underline decoration-dotted underline-offset-2 ${
                              row.collectionStatus === 'Collected from Bank'
                                ? 'text-[#16A34A]'
                                : isOverdue
                                ? 'text-[#DC2626]'
                                : 'text-[#B45309]'
                            }`}
                            title="Click to toggle bank pickup status"
                          >
                            {row.collectionStatus}
                          </button>
                          {row.cheque.collectedFromBankDate && (
                            <div className="text-[10px] font-mono-num text-[#627D98]">
                              {formatIndianDate(row.cheque.collectedFromBankDate)}
                            </div>
                          )}
                          {isOverdue && elapsedMs !== null && (
                            <div className="mt-0.5 text-[10px] font-mono-num font-semibold text-[#DC2626] flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                              <span>{formatExactElapsedDuration(elapsedMs)} elapsed</span>
                            </div>
                          )}
                          {!isOverdue && graceRemainingMs !== null && (
                            <div className="mt-0.5 text-[10px] font-mono-num text-[#B45309] flex items-center gap-1">
                              <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                              <span>Grace: {formatExactElapsedDuration(graceRemainingMs)} left</span>
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 min-w-[190px]">
                          <div
                            className={`font-semibold ${
                              row.cheque.status === 'Re-Deposited'
                                ? 'text-[#176B87]'
                                : row.recoveryStatus === 'Recovered / Settled'
                                ? 'text-[#16A34A]'
                                : row.recoveryStatus === 'Partially Recovered'
                                ? 'text-[#B45309]'
                                : 'text-[#DC2626]'
                            }`}
                          >
                            {row.cheque.status === 'Re-Deposited'
                              ? 'Re-Deposited (2nd Presentation)'
                              : row.recoveryStatus}
                          </div>
                          {row.cheque.status === 'Re-Deposited' ? (
                            <div className="text-[11px] font-mono-num text-[#176B87]">
                              Moved → {row.cheque.reDepositedToBatchRef || 'New Batch'}
                            </div>
                          ) : (
                            <div className="text-[11px] font-mono-num text-[#627D98]">
                              Paid: {formatINR(row.recoveredAmount)} · Bal:{' '}
                              {formatINR(row.unrecoveredAmount)}
                            </div>
                          )}
                          {(row.cheque.bounceChargesCollected ?? 0) > 0 && (
                            <div className="text-[10px] font-mono-num text-[#627D98]">
                              Charges Collected:{' '}
                              {formatINR(row.cheque.bounceChargesCollected ?? 0)}
                            </div>
                          )}
                          {row.cheque.replacementChequeNumber ? (
                            <div className="text-[10px] font-mono-num text-[#16A34A]">
                              Replaced by Chq #{row.cheque.replacementChequeNumber} (
                              {row.cheque.replacementBankName})
                            </div>
                          ) : (
                            row.cheque.recoveryRef && (
                              <div className="text-[10px] font-mono-num text-[#627D98]">
                                {row.cheque.recoveryMode} · {row.cheque.recoveryRef}
                              </div>
                            )
                          )}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => setHistoryDrawerCheque(row.cheque)}
                              title="View Cheque Activity History"
                              className="p-1.5 text-[#627D98] hover:text-[#102A43] bg-white border border-[#D9E2EC] rounded hover:bg-[#F4F7FA] transition-colors"
                            >
                              <History className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                            {row.cheque.status !== 'Re-Deposited' && (
                              <button
                                type="button"
                                onClick={() => openRecoveryModal(row)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-[#102A43] bg-[#14B8A6] rounded hover:bg-[#0D9488] transition-colors"
                              >
                                <Wallet className="w-3 h-3" aria-hidden="true" />
                                <span>Record Recovery / Action</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        /* TAB 2: Bank-Wise Collection Checklist (For Field Staff) */
        <>
          <section className="no-print bg-white border border-[#D9E2EC] rounded-lg p-5 space-y-4 shadow-xs">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[#102A43]">
                  Bank-Wise Collection Checklist (Field Staff Pickup Sheet)
                </h2>
                <p className="text-xs text-[#627D98] mt-0.5">
                  Groups all uncollected returned cheques by Deposit Bank Name &amp; Branch for physical bank counter collection.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadChecklistPdf}
                  disabled={checklistGroups.length === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Download Checklist PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={checklistGroups.length === 0}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] disabled:opacity-50 transition-colors whitespace-nowrap"
                >
                  <Printer className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
                  <span>Print Checklist</span>
                </button>
              </div>
            </div>

            {pdfNotice && (
              <div className="p-3 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md text-xs text-[#102A43] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                  <span>
                    Checklist PDF generated:{' '}
                    <strong className="font-mono-num">
                      {pdfNotice.filename}
                    </strong>
                  </span>
                </div>
                <a
                  href={pdfNotice.blobUrl}
                  download={pdfNotice.filename}
                  className="font-semibold text-[#16A34A] underline hover:text-[#102A43]"
                >
                  Click here if download didn&apos;t start
                </a>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-4 text-xs text-[#627D98] pt-1">
              <span>
                Branches to Visit:{' '}
                <strong className="font-mono-num text-[#102A43]">
                  {checklistTotals.branchCount}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Uncollected Instruments:{' '}
                <strong className="font-mono-num text-[#B45309]">
                  {checklistTotals.count}
                </strong>
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Total Uncollected Value:{' '}
                <strong className="font-mono-num text-[#102A43]">
                  {formatINR(checklistTotals.amount)}
                </strong>
              </span>
              {checklistTotals.overdueCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="overdue-blink-badge inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#DC2626] text-white text-[11px] font-bold font-mono-num">
                    <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                    <span>{checklistTotals.overdueCount} Overdue (12+ Hrs)</span>
                  </span>
                </>
              )}
            </div>
          </section>

          {/* Screen Interactive Checklist Cards + Printable A4 View */}
          {checklistGroups.length === 0 ? (
            <div className="no-print bg-white border border-[#D9E2EC] rounded-lg p-12 text-center space-y-2 shadow-xs">
              <ClipboardCheck className="w-8 h-8 text-[#16A34A] mx-auto" />
              <p className="text-sm font-medium text-[#102A43]">
                All returned cheques have been collected from the bank
              </p>
              <p className="text-xs text-[#627D98]">
                Any newly returned cheques marked &ldquo;Pending Collection&rdquo; will appear here grouped by Bank &amp; Branch.
              </p>
            </div>
          ) : (
            <div className="print-only-root space-y-5">
              {/* Printable Header (visible on print) */}
              <div className="hidden print:block border-b-2 border-slate-900 pb-2 mb-4">
                <h1 className="text-sm font-bold uppercase text-slate-950">
                  Bank-Wise Returned Cheque Collection Checklist (Field Staff)
                </h1>
                <div className="text-[10px] text-slate-700 flex justify-between mt-1">
                  <span>
                    {companyScope === 'all'
                      ? `Consolidated (${companies.length} Companies)`
                      : activeCompany.profile.companyName}
                  </span>
                  <span className="font-mono-num">
                    Date: {formatIndianDate(new Date().toISOString().slice(0, 10))} ·{' '}
                    {checklistTotals.count} Cheques · {formatINR(checklistTotals.amount)}
                  </span>
                </div>
              </div>

              {checklistGroups.map((grp) => (
                <section
                  key={grp.key}
                  className="bg-white border border-[#D9E2EC] rounded-lg overflow-hidden avoid-break shadow-xs"
                >
                  <div className="px-5 py-3.5 bg-[#102A43] text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex items-start gap-2.5">
                      <Landmark className="w-4 h-4 text-[#14B8A6] shrink-0 mt-0.5" />
                      <div>
                        <h3 className="text-sm font-semibold">
                          {grp.bankName} — {grp.branchName}
                        </h3>
                        <p className="text-[11px] text-[#D9E2EC] font-mono-num">
                          A/c: {grp.accountNumber} · IFSC: {grp.ifscCode}
                          {grp.branchAddress ? ` · ${grp.branchAddress}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right font-mono-num text-xs shrink-0">
                      <div className="font-bold text-[#14B8A6]">
                        {grp.items.length} Cheque{grp.items.length === 1 ? '' : 's'} ·{' '}
                        {formatINR(grp.totalAmount)}
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-[#D9E2EC] bg-[#F4F7FA] text-[11px] font-semibold text-[#627D98]">
                          <th className="py-2 pl-4 pr-2 w-10 text-center">Pick</th>
                          <th className="py-2 px-2 w-10 text-center">S.No</th>
                          <th className="py-2 px-3">Cheque No.</th>
                          <th className="py-2 px-3">Cheque Date</th>
                          <th className="py-2 px-3">Customer / Party Name</th>
                          <th className="py-2 px-3">Return Reason</th>
                          <th className="py-2 px-3 text-right">Amount (₹)</th>
                          <th className="no-print py-2 px-4 text-right">
                            Field Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#D9E2EC]">
                        {grp.items.map((item, idx) => {
                          const targetCompany = companies.find(
                            (c) => c.profile.companyName === item.companyName
                          );
                          const isOverdue = isReturnedChequeOverdue(item.cheque, nowMs);
                          const elapsedMs = getElapsedSinceReturnMs(item.cheque, nowMs);
                          const graceRemainingMs = getGraceRemainingMs(item.cheque, nowMs);
                          const isFocusedRow =
                            focusedChecklistChequeId === item.cheque.id;
                          return (
                            <tr
                              key={item.cheque.id}
                              data-checklist-cheque-id={item.cheque.id}
                              className={`transition-colors print:bg-transparent print:border-l-0 print:ring-0 ${
                                isFocusedRow
                                  ? 'bg-[#DC2626]/14 ring-2 ring-inset ring-[#DC2626] border-l-4 border-l-[#DC2626]'
                                  : isOverdue
                                  ? 'bg-[#DC2626]/8 hover:bg-[#DC2626]/12 border-l-4 border-l-[#DC2626]'
                                  : 'hover:bg-[#F4F7FA]/80'
                              }`}
                            >
                              <td className="py-2.5 pl-4 pr-2 text-center">
                                <span
                                  className="inline-block w-3.5 h-3.5 border border-[#627D98] rounded-xs align-middle"
                                  aria-hidden="true"
                                />
                              </td>
                              <td className="py-2.5 px-2 text-center font-mono-num text-[#627D98]">
                                {idx + 1}
                              </td>
                              <td className="py-2.5 px-3 whitespace-nowrap">
                                <div className="font-mono-num font-bold text-[#176B87]">
                                  #{item.cheque.chequeNumber}
                                </div>
                                {isOverdue && (
                                  <span className="no-print mt-1 overdue-blink-badge inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#DC2626] text-white text-[10px] font-bold">
                                    <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" />
                                    <span>12+ Hrs Overdue</span>
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-mono-num text-[#243B53] whitespace-nowrap">
                                {formatIndianDate(item.cheque.chequeDate)}
                              </td>
                              <td className="py-2.5 px-3">
                                <div className="font-semibold text-[#102A43]">
                                  {item.cheque.partyName}
                                </div>
                                <div className="text-[11px] text-[#627D98] font-mono-num">
                                  {item.cheque.draweeBank} · {item.batchRef}
                                  {companyScope === 'all' &&
                                    ` · ${item.companyName}`}
                                </div>
                                {isOverdue && elapsedMs !== null && (
                                  <div className="no-print text-[10px] font-mono-num font-semibold text-[#DC2626] mt-0.5 flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                                    <span>
                                      {formatExactElapsedDuration(elapsedMs)} since Return Update
                                    </span>
                                  </div>
                                )}
                                {!isOverdue && graceRemainingMs !== null && (
                                  <div className="no-print text-[10px] font-mono-num text-[#B45309] mt-0.5 flex items-center gap-1">
                                    <Clock className="w-2.5 h-2.5" aria-hidden="true" />
                                    <span>
                                      12h SLA Grace: {formatExactElapsedDuration(graceRemainingMs)} left
                                    </span>
                                  </div>
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-medium text-[#DC2626]">
                                {normalizeReasonLabel(item.cheque.bounceReason)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-num font-bold text-[#102A43] whitespace-nowrap">
                                {formatINR(item.cheque.amount)}
                              </td>
                              <td className="no-print py-2.5 px-4 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (!targetCompany) return;
                                    setFocusedChecklistChequeId(null);
                                    onUpdateChequeRecovery(
                                      targetCompany.id,
                                      item.cheque.id,
                                      {
                                        bankCollectionStatus:
                                          'Collected from Bank',
                                        collectedFromBankDate: new Date()
                                          .toISOString()
                                          .slice(0, 10),
                                      }
                                    );
                                  }}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#16A34A] bg-[#16A34A]/10 border border-[#16A34A]/30 rounded hover:bg-[#16A34A]/20 transition-colors"
                                >
                                  <CheckCircle2
                                    className="w-3 h-3"
                                    aria-hidden="true"
                                  />
                                  <span>Mark Collected</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      {/* Re-Deposit & Replacement / Recovery Action Modal */}
      {recoveryModalTarget && (
        (() => {
          const targetComp =
            companies.find((c) => c.id === recoveryModalTarget.companyId) ||
            activeCompany;
          return (
            <RecoveryActionModal
              cheque={recoveryModalTarget.cheque}
              batches={targetComp.batches}
              bankAccounts={targetComp.bankAccounts}
              activeBatchId={targetComp.activeBatchId}
              onClose={() => setRecoveryModalTarget(null)}
              onSubmit={(submission) => {
                if (onExecuteRecoveryAction) {
                  onExecuteRecoveryAction(
                    recoveryModalTarget.companyId,
                    recoveryModalTarget.cheque.id,
                    submission
                  );
                } else if (
                  submission.choice === 'NEFT_RTGS_UPI' ||
                  submission.choice === 'CASH'
                ) {
                  const newPaid = Math.min(
                    recoveryModalTarget.cheque.amount,
                    recoveryModalTarget.recoveredAmount +
                      submission.receivedAmount
                  );
                  onUpdateChequeRecovery(
                    recoveryModalTarget.companyId,
                    recoveryModalTarget.cheque.id,
                    {
                      recoveredAmount: newPaid,
                      recoveryMode:
                        submission.choice === 'CASH'
                          ? 'Cash'
                          : 'NEFT / RTGS / UPI',
                      recoveryRef: submission.refNumber,
                      recoveryDate: submission.paymentDate,
                      bankCollectionStatus: submission.bankCollectionStatus,
                      remarks: submission.remarks,
                    }
                  );
                }
                setRecoveryModalTarget(null);
              }}
            />
          );
        })()
      )}

      {historyDrawerCheque && (
        <ChequeActivityDrawer
          cheque={historyDrawerCheque}
          logs={auditLogs.filter((l) => l.chequeId === historyDrawerCheque.id)}
          onClose={() => setHistoryDrawerCheque(null)}
        />
      )}
    </div>
  );
}
