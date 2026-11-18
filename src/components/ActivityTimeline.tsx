import React from 'react';
import {
  ArrowRight,
  Clock,
  FileCheck2,
  FileSpreadsheet,
  History,
  Lock,
  Paperclip,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  Unlock,
  User,
  Wallet,
  X,
} from 'lucide-react';
import {
  ChequeEntry,
  ClearingBatch,
  SystemAuditAction,
  SystemAuditLogEntry,
} from '../types/treasury';
import {
  AUDIT_ACTION_LABELS,
  formatAuditTimestamp,
} from '../utils/auditHelpers';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';

interface ActivityTimelineProps {
  entries: SystemAuditLogEntry[];
  emptyMessage?: string;
  showCompany?: boolean;
}

function getActionTone(action: SystemAuditAction): {
  iconBg: string;
  text: string;
  Icon: React.ComponentType<{ className?: string }>;
} {
  switch (action) {
    case 'BATCH_LOCKED':
      return {
        iconBg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        text: 'text-emerald-800',
        Icon: Lock,
      };
    case 'BATCH_UNLOCKED':
      return {
        iconBg: 'bg-amber-50 border-amber-200 text-amber-800',
        text: 'text-amber-800',
        Icon: Unlock,
      };
    case 'BATCH_CREATED':
    case 'CHEQUE_ADDED':
      return {
        iconBg: 'bg-slate-100 border-slate-300 text-slate-800',
        text: 'text-slate-900',
        Icon: Plus,
      };
    case 'CHEQUE_DELETED':
      return {
        iconBg: 'bg-red-50 border-red-200 text-red-700',
        text: 'text-red-700',
        Icon: Trash2,
      };
    case 'BANK_STATEMENT_UPLOADED':
      return {
        iconBg: 'bg-blue-50 border-blue-200 text-blue-800',
        text: 'text-blue-800',
        Icon: FileSpreadsheet,
      };
    case 'RETURN_ACK_GENERATED':
      return {
        iconBg: 'bg-red-50 border-red-200 text-red-800',
        text: 'text-red-800',
        Icon: FileCheck2,
      };
    case 'RECOVERY_UPDATED':
      return {
        iconBg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        text: 'text-emerald-800',
        Icon: Wallet,
      };
    case 'DOCUMENT_UPLOADED':
      return {
        iconBg: 'bg-indigo-50 border-indigo-200 text-indigo-800',
        text: 'text-indigo-800',
        Icon: Paperclip,
      };
    case 'DOCUMENT_SHARED':
      return {
        iconBg: 'bg-emerald-50 border-emerald-200 text-emerald-800',
        text: 'text-emerald-800',
        Icon: Share2,
      };
    case 'DOCUMENT_DELETED':
      return {
        iconBg: 'bg-red-50 border-red-200 text-red-700',
        text: 'text-red-700',
        Icon: Trash2,
      };
    default:
      return {
        iconBg: 'bg-slate-100 border-slate-300 text-slate-700',
        text: 'text-slate-900',
        Icon: RefreshCw,
      };
  }
}

export function ActivityTimeline({
  entries,
  emptyMessage = 'No activity history recorded yet.',
  showCompany = false,
}: ActivityTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className="py-8 px-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-md bg-slate-50/50">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
      {entries.map((entry) => {
        const { iconBg, text, Icon } = getActionTone(entry.actionType);
        return (
          <li key={entry.id} className="relative pl-10">
            <span
              className={`absolute left-0 top-0.5 w-8 h-8 rounded-full border flex items-center justify-center ${iconBg}`}
              aria-hidden="true"
            >
              <Icon className="w-3.5 h-3.5" />
            </span>

            <div className="bg-white border border-slate-200 rounded-md p-3 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${text}`}>
                    {AUDIT_ACTION_LABELS[entry.actionType] || entry.actionType}
                  </span>
                  {entry.batchRef && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono-num text-[11px] text-slate-700 font-medium">
                        {entry.batchRef}
                      </span>
                    </>
                  )}
                  {entry.chequeNumber && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono-num text-[11px] text-slate-900 font-semibold">
                        Chq #{entry.chequeNumber}
                      </span>
                    </>
                  )}
                  {entry.customerName && !entry.chequeNumber && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-[11px] text-slate-700 font-medium">
                        {entry.customerName}
                      </span>
                    </>
                  )}
                  {entry.documentTitle && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-[11px] text-indigo-700 font-medium">
                        {entry.documentTitle}
                      </span>
                    </>
                  )}
                </div>

                <span className="inline-flex items-center gap-1 text-[11px] font-mono-num text-slate-500">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  <span>{formatAuditTimestamp(entry.timestamp)}</span>
                </span>
              </div>

              <p className="text-xs text-slate-700 leading-relaxed">
                {entry.description}
              </p>

              {(entry.oldValue || entry.newValue) && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] font-mono-num">
                  {entry.oldValue && (
                    <span className="text-slate-500 line-through">
                      {entry.oldValue}
                    </span>
                  )}
                  {entry.oldValue && entry.newValue && (
                    <ArrowRight
                      className="w-3 h-3 text-slate-400"
                      aria-hidden="true"
                    />
                  )}
                  {entry.newValue && (
                    <span className="font-semibold text-slate-900">
                      {entry.newValue}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <User className="w-3 h-3" aria-hidden="true" />
                  <strong className="font-medium text-slate-700">
                    {entry.actor}
                  </strong>
                </span>
                {showCompany && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{entry.companyName}</span>
                  </>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

interface ChequeActivityDrawerProps {
  cheque: ChequeEntry;
  batch?: ClearingBatch;
  logs: SystemAuditLogEntry[];
  onClose: () => void;
}

export function ChequeActivityDrawer({
  cheque,
  batch,
  logs,
  onClose,
}: ChequeActivityDrawerProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cheque-history-drawer-title"
    >
      <div className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-slate-900" aria-hidden="true" />
            <div>
              <h3
                id="cheque-history-drawer-title"
                className="text-base font-semibold text-slate-900"
              >
                Cheque #{cheque.chequeNumber} — Activity History
              </h3>
              <p className="text-xs text-slate-500">
                {cheque.partyName} · {batch?.batchRef || 'Clearing Batch'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-200/60"
            aria-label="Close activity drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Cheque Snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50 border border-slate-200 rounded-md text-xs">
            <div>
              <div className="text-slate-500">Amount</div>
              <div className="font-mono-num font-bold text-slate-950 mt-0.5">
                {formatINR(cheque.amount)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Cheque Date</div>
              <div className="font-mono-num font-semibold text-slate-900 mt-0.5">
                {formatIndianDate(cheque.chequeDate)}
              </div>
            </div>
            <div>
              <div className="text-slate-500">Current Status</div>
              <div className="font-semibold text-slate-900 mt-0.5">
                {cheque.status}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-3 pt-2 border-t border-slate-200 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
              <span>
                Drawee: <strong className="text-slate-800">{cheque.draweeBank}</strong> ({cheque.draweeBranch})
              </span>
              {cheque.bounceReason && (
                <span className="text-red-700 font-medium">
                  Return Reason: {cheque.bounceReason}
                </span>
              )}
              {(cheque.recoveredAmount ?? 0) > 0 && (
                <span className="text-emerald-700 font-medium font-mono-num">
                  Recovered: {formatINR(cheque.recoveredAmount ?? 0)}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">
                Chronological Audit Timeline ({logs.length})
              </span>
              <span className="text-[11px] text-slate-500">
                Newest events first
              </span>
            </div>

            <ActivityTimeline
              entries={logs}
              emptyMessage="No logged events for this specific cheque yet. Status transitions, edits, statement matches, and recoveries will appear here automatically."
            />
          </div>
        </div>
      </div>
    </div>
  );
}
