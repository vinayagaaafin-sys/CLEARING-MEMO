import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  History,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  CompanyWorkspace,
  SystemAuditAction,
  SystemAuditLogEntry,
} from '../types/treasury';
import {
  ALL_AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  exportAuditLogsToExcel,
  formatAuditTimestamp,
} from '../utils/auditHelpers';
import { ActivityTimeline } from './ActivityTimeline';

interface SystemAuditLogViewProps {
  companies: CompanyWorkspace[];
  auditLogs: SystemAuditLogEntry[];
}

export function SystemAuditLogView({
  companies,
  auditLogs,
}: SystemAuditLogViewProps) {
  const [companyFilter, setCompanyFilter] = useState<string>('ALL');
  const [batchFilter, setBatchFilter] = useState<string>('ALL');
  const [actionFilter, setActionFilter] = useState<string>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [appliedFilters, setAppliedFilters] = useState({
    companyFilter: 'ALL',
    batchFilter: 'ALL',
    actionFilter: 'ALL',
    dateFrom: '',
    dateTo: '',
    searchQuery: '',
  });

  const [viewMode, setViewMode] = useState<'table' | 'timeline'>('table');
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const availableBatches = useMemo(() => {
    const list: { batchRef: string; companyName: string }[] = [];
    const seen = new Set<string>();
    for (const comp of companies) {
      if (companyFilter !== 'ALL' && comp.id !== companyFilter) continue;
      for (const b of comp.batches) {
        if (!seen.has(b.batchRef)) {
          seen.add(b.batchRef);
          list.push({ batchRef: b.batchRef, companyName: comp.profile.companyName });
        }
      }
    }
    for (const log of auditLogs) {
      if (companyFilter !== 'ALL' && log.companyId !== companyFilter) continue;
      if (log.batchRef && !seen.has(log.batchRef)) {
        seen.add(log.batchRef);
        list.push({ batchRef: log.batchRef, companyName: log.companyName });
      }
    }
    return list.sort((a, b) => a.batchRef.localeCompare(b.batchRef));
  }, [companies, auditLogs, companyFilter]);

  const handleSubmitFilters = () => {
    setAppliedFilters({
      companyFilter,
      batchFilter,
      actionFilter,
      dateFrom,
      dateTo,
      searchQuery,
    });
    setHasSubmitted(true);
  };

  const isPendingSubmit =
    hasSubmitted &&
    (companyFilter !== appliedFilters.companyFilter ||
      batchFilter !== appliedFilters.batchFilter ||
      actionFilter !== appliedFilters.actionFilter ||
      dateFrom !== appliedFilters.dateFrom ||
      dateTo !== appliedFilters.dateTo ||
      searchQuery !== appliedFilters.searchQuery);

  const filteredLogs = useMemo(() => {
    if (!hasSubmitted) return [];
    const q = appliedFilters.searchQuery.trim().toLowerCase();
    return auditLogs.filter((entry) => {
      if (
        appliedFilters.companyFilter !== 'ALL' &&
        entry.companyId !== appliedFilters.companyFilter
      )
        return false;
      if (
        appliedFilters.batchFilter !== 'ALL' &&
        entry.batchRef !== appliedFilters.batchFilter
      )
        return false;
      if (
        appliedFilters.actionFilter !== 'ALL' &&
        entry.actionType !== appliedFilters.actionFilter
      )
        return false;

      const entryDate = entry.timestamp.slice(0, 10);
      if (appliedFilters.dateFrom && entryDate < appliedFilters.dateFrom)
        return false;
      if (appliedFilters.dateTo && entryDate > appliedFilters.dateTo)
        return false;

      if (q) {
        const hay = `${entry.companyName} ${entry.batchRef || ''} ${entry.chequeNumber || ''} ${entry.customerName || ''} ${entry.documentTitle || ''} ${entry.actor} ${entry.description} ${entry.oldValue || ''} ${entry.newValue || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [auditLogs, hasSubmitted, appliedFilters]);

  const hasFilters =
    companyFilter !== 'ALL' ||
    batchFilter !== 'ALL' ||
    actionFilter !== 'ALL' ||
    Boolean(dateFrom) ||
    Boolean(dateTo) ||
    Boolean(searchQuery);

  const resetFilters = () => {
    const defaults = {
      companyFilter: 'ALL',
      batchFilter: 'ALL',
      actionFilter: 'ALL',
      dateFrom: '',
      dateTo: '',
      searchQuery: '',
    };
    setCompanyFilter('ALL');
    setBatchFilter('ALL');
    setActionFilter('ALL');
    setDateFrom('');
    setDateTo('');
    setSearchQuery('');
    setAppliedFilters(defaults);
  };

  const uniqueActorsCount = useMemo(
    () => new Set(filteredLogs.map((l) => l.actor)).size,
    [filteredLogs]
  );

  const handleExport = () => {
    const filename = exportAuditLogsToExcel(filteredLogs);
    setExportNotice(filename);
    setTimeout(() => setExportNotice(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Header & Summary Strip */}
      <section className="bg-white border border-[#D9E2EC] rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#D9E2EC]">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-[#102A43] text-[#14B8A6] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#102A43]">
                Global System Audit Log &amp; Compliance Trail
              </h2>
              <p className="text-xs text-[#627D98] mt-0.5">
                Immutable chronological record of batch creation, locks/unlocks, cheque status transitions, bank statement reconciliations, acknowledgement letters, and recoveries.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleSubmitFilters}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] transition-colors whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Submit</span>
            </button>

            <div className="flex p-0.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  viewMode === 'table'
                    ? 'bg-white text-[#102A43] shadow-xs font-semibold'
                    : 'text-[#627D98] hover:text-[#102A43]'
                }`}
              >
                Ledger Table
              </button>
              <button
                type="button"
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  viewMode === 'timeline'
                    ? 'bg-white text-[#102A43] shadow-xs font-semibold'
                    : 'text-[#627D98] hover:text-[#102A43]'
                }`}
              >
                Timeline View
              </button>
            </div>

            <button
              type="button"
              onClick={handleExport}
              disabled={!hasSubmitted || filteredLogs.length === 0}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#176B87] rounded-md hover:bg-[#102A43] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export Audit Log (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-[11px] font-medium text-[#627D98] mb-1">
              Search Keyword
            </label>
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-[#627D98] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSubmitFilters();
                  }
                }}
                placeholder="Search cheque #, actor, batch, filename..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#627D98] mb-1">
              Company
            </label>
            <select
              value={companyFilter}
              onChange={(e) => {
                setCompanyFilter(e.target.value);
                setBatchFilter('ALL');
              }}
              className="w-full px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
            >
              <option value="ALL">All Companies ({companies.length})</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.profile.companyName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#627D98] mb-1">
              Batch Number
            </label>
            <select
              value={batchFilter}
              onChange={(e) => setBatchFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
            >
              <option value="ALL">All Batches</option>
              {availableBatches.map((b) => (
                <option key={b.batchRef} value={b.batchRef}>
                  {b.batchRef}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#627D98] mb-1">
              Action Type
            </label>
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
            >
              <option value="ALL">All Action Types</option>
              {ALL_AUDIT_ACTIONS.map((act) => (
                <option key={act} value={act}>
                  {AUDIT_ACTION_LABELS[act]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-[#627D98] mb-1">
                From
              </label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-2 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>
            <div className="flex-1">
              <label className="block text-[11px] font-medium text-[#627D98] mb-1">
                To
              </label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-2 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-[#627D98]">
          <div className="flex flex-wrap items-center gap-3">
            {hasSubmitted ? (
              <>
                <span>
                  Showing{' '}
                  <strong className="font-mono-num text-[#102A43]">
                    {filteredLogs.length}
                  </strong>{' '}
                  of{' '}
                  <strong className="font-mono-num text-[#102A43]">
                    {auditLogs.length}
                  </strong>{' '}
                  events
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  Action Performers:{' '}
                  <strong className="font-mono-num text-[#102A43]">
                    {uniqueActorsCount}
                  </strong>
                </span>
                {isPendingSubmit && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="text-[#B45309] font-medium">
                      Filters updated — click Submit to refresh results
                    </span>
                  </>
                )}
              </>
            ) : (
              <span>
                <strong className="font-mono-num text-[#102A43]">
                  {auditLogs.length}
                </strong>{' '}
                audit events recorded — click{' '}
                <strong className="text-[#102A43]">Submit</strong> to display
                data
              </span>
            )}
          </div>

          {hasFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#176B87] hover:text-[#102A43]"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              <span>Reset All Filters</span>
            </button>
          )}
        </div>
      </section>

      {exportNotice && (
        <div
          role="status"
          className="px-4 py-2.5 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md text-xs text-[#243B53] flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>
              Audit log exported:{' '}
              <strong className="font-mono-num text-[#102A43]">{exportNotice}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            className="p-1 text-[#627D98] hover:text-[#102A43]"
            aria-label="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Content */}
      {!hasSubmitted ? (
        <section className="bg-white border border-[#D9E2EC] rounded-lg py-14 px-6 text-center space-y-3">
          <History
            className="w-7 h-7 text-[#627D98]/60 mx-auto"
            aria-hidden="true"
          />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-[#102A43]">
              Select filters and click Submit to show audit data
            </h3>
            <p className="text-xs text-[#627D98] max-w-md mx-auto">
              Filter by Company, Batch Number, Action Type, Date Range, or
              keyword above, then click Submit to view matching activity history.
            </p>
          </div>
        </section>
      ) : viewMode === 'timeline' ? (
        <section className="bg-white border border-[#D9E2EC] rounded-lg p-5">
          <ActivityTimeline
            entries={filteredLogs}
            showCompany
            emptyMessage="No audit log entries match the selected filters."
          />
        </section>
      ) : (
        <section className="bg-white border border-[#D9E2EC] rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#D9E2EC] bg-[#F4F7FA] text-[11px] font-semibold text-[#627D98]">
                  <th className="py-2.5 px-4">Date &amp; Time</th>
                  <th className="py-2.5 px-3">Company</th>
                  <th className="py-2.5 px-3">Batch / Cheque</th>
                  <th className="py-2.5 px-3">Action Type</th>
                  <th className="py-2.5 px-3">Performed By</th>
                  <th className="py-2.5 px-4">Description of Changes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#D9E2EC] text-xs">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-12 px-4 text-center text-[#627D98]"
                    >
                      <History className="w-6 h-6 text-[#627D98]/50 mx-auto mb-2" />
                      No activity history entries matched the selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredLogs.map((entry: SystemAuditLogEntry) => (
                    <tr
                      key={entry.id}
                      className="hover:bg-[#F4F7FA]/80 transition-colors align-top"
                    >
                      <td className="py-3 px-4 font-mono-num text-[11px] text-[#627D98] whitespace-nowrap">
                        {formatAuditTimestamp(entry.timestamp)}
                      </td>
                      <td className="py-3 px-3 text-[#243B53] max-w-[190px]">
                        <div className="truncate font-medium" title={entry.companyName}>
                          {entry.companyName}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap font-mono-num">
                        <div className="text-[#102A43] font-medium">
                          {entry.batchRef || '—'}
                        </div>
                        {entry.chequeNumber && (
                          <div className="text-[11px] text-[#176B87]">
                            Chq #{entry.chequeNumber}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            entry.actionType === 'BATCH_UNLOCKED'
                              ? 'text-[#B45309]'
                              : entry.actionType === 'CHEQUE_DELETED' ||
                                entry.actionType === 'RETURN_ACK_GENERATED'
                              ? 'text-[#DC2626]'
                              : entry.actionType === 'BATCH_LOCKED' ||
                                entry.actionType === 'RECOVERY_UPDATED'
                              ? 'text-[#16A34A]'
                              : 'text-[#102A43]'
                          }`}
                        >
                          {AUDIT_ACTION_LABELS[
                            entry.actionType as SystemAuditAction
                          ] || entry.actionType}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-[#243B53] min-w-[160px]">
                        {entry.actor}
                      </td>
                      <td className="py-3 px-4 text-[#243B53] min-w-[280px]">
                        <div>{entry.description}</div>
                        {(entry.oldValue || entry.newValue) && (
                          <div className="mt-1 text-[11px] font-mono-num text-[#627D98]">
                            {entry.oldValue ? `${entry.oldValue} → ` : ''}
                            <strong className="text-[#102A43]">
                              {entry.newValue}
                            </strong>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
