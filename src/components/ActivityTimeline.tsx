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
        iconBg: 'bg-[#16A34A]/10 border-[#16A34A]/30 text-[#16A34A]',
        text: 'text-[#16A34A]',
        Icon: Lock,
      };
    case 'BATCH_UNLOCKED':
      return {
        iconBg: 'bg-[#F59E0B]/10 border-[#F59E0B]/35 text-[#B45309]',
        text: 'text-[#B45309]',
        Icon: Unlock,
      };
    case 'BATCH_CREATED':
    case 'CHEQUE_ADDED':
      return {
        iconBg: 'bg-[#F4F7FA] border-[#D9E2EC] text-[#102A43]',
        text: 'text-[#102A43]',
        Icon: Plus,
      };
    case 'CHEQUE_DELETED':
      return {
        iconBg: 'bg-[#DC2626]/10 border-[#DC2626]/30 text-[#DC2626]',
        text: 'text-[#DC2626]',
        Icon: Trash2,
      };
    case 'BANK_STATEMENT_UPLOADED':
      return {
        iconBg: 'bg-[#2563EB]/10 border-[#2563EB]/30 text-[#2563EB]',
        text: 'text-[#2563EB]',
        Icon: FileSpreadsheet,
      };
    case 'RETURN_ACK_GENERATED':
      return {
        iconBg: 'bg-[#DC2626]/10 border-[#DC2626]/30 text-[#DC2626]',
        text: 'text-[#DC2626]',
        Icon: FileCheck2,
      };
    case 'RECOVERY_UPDATED':
      return {
        iconBg: 'bg-[#16A34A]/10 border-[#16A34A]/30 text-[#16A34A]',
        text: 'text-[#16A34A]',
        Icon: Wallet,
      };
    case 'DOCUMENT_UPLOADED':
      return {
        iconBg: 'bg-[#176B87]/10 border-[#176B87]/30 text-[#176B87]',
        text: 'text-[#176B87]',
        Icon: Paperclip,
      };
    case 'DOCUMENT_SHARED':
      return {
        iconBg: 'bg-[#14B8A6]/15 border-[#14B8A6]/40 text-[#0F766E]',
        text: 'text-[#0F766E]',
        Icon: Share2,
      };
    case 'DOCUMENT_DELETED':
      return {
        iconBg: 'bg-[#DC2626]/10 border-[#DC2626]/30 text-[#DC2626]',
        text: 'text-[#DC2626]',
        Icon: Trash2,
      };
    default:
      return {
        iconBg: 'bg-[#F4F7FA] border-[#D9E2EC] text-[#243B53]',
        text: 'text-[#102A43]',
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
      <div className="py-8 px-4 text-center text-xs text-[#627D98] border border-dashed border-[#D9E2EC] rounded-md bg-[#F4F7FA]/60">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ol className="relative space-y-4 before:absolute before:left-[15px] before:top-2 before:bottom-2 before:w-px before:bg-[#D9E2EC]">
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

            <div className="bg-white border border-[#D9E2EC] rounded-md p-3 space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`font-semibold ${text}`}>
                    {AUDIT_ACTION_LABELS[entry.actionType] || entry.actionType}
                  </span>
                  {entry.batchRef && (
                    <>
                      <span className="text-[#D9E2EC]" aria-hidden="true">·</span>
                      <span className="font-mono-num text-[11px] text-[#243B53] font-medium">
                        {entry.batchRef}
                      </span>
                    </>
                  )}
                  {entry.chequeNumber && (
                    <>
                      <span className="text-[#D9E2EC]" aria-hidden="true">·</span>
                      <span className="font-mono-num text-[11px] text-[#102A43] font-semibold">
                        Chq #{entry.chequeNumber}
                      </span>
                    </>
                  )}
                  {entry.customerName && !entry.chequeNumber && (
                    <>
                      <span className="text-[#D9E2EC]" aria-hidden="true">·</span>
                      <span className="text-[11px] text-[#243B53] font-medium">
                        {entry.customerName}
                      </span>
                    </>
                  )}
                  {entry.documentTitle && (
                    <>
                      <span className="text-[#D9E2EC]" aria-hidden="true">·</span>
                      <span className="text-[11px] text-[#176B87] font-medium">
                        {entry.documentTitle}
                      </span>
                    </>
                  )}
                </div>

                <span className="inline-flex items-center gap-1 text-[11px] font-mono-num text-[#627D98]">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  <span>{formatAuditTimestamp(entry.timestamp)}</span>
                </span>
              </div>

              <p className="text-xs text-[#243B53] leading-relaxed">
                {entry.description}
              </p>

              {(entry.oldValue || entry.newValue) && (
                <div className="flex flex-wrap items-center gap-2 pt-0.5 text-[11px] font-mono-num">
                  {entry.oldValue && (
                    <span className="text-[#627D98] line-through">
                      {entry.oldValue}
                    </span>
                  )}
                  {entry.oldValue && entry.newValue && (
                    <ArrowRight
                      className="w-3 h-3 text-[#627D98]"
                      aria-hidden="true"
                    />
                  )}
                  {entry.newValue && (
                    <span className="font-semibold text-[#102A43]">
                      {entry.newValue}
                    </span>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-[#D9E2EC] text-[11px] text-[#627D98]">
                <span className="inline-flex items-center gap-1">
                  <User className="w-3 h-3" aria-hidden="true" />
                  <strong className="font-medium text-[#243B53]">
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
      className="fixed inset-0 z-50 flex justify-end bg-[#102A43]/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cheque-history-drawer-title"
    >
      <div className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-[#D9E2EC] flex flex-col">
        <div className="px-6 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <History className="w-4 h-4 text-[#176B87]" aria-hidden="true" />
            <div>
              <h3
                id="cheque-history-drawer-title"
                className="text-base font-semibold text-[#102A43]"
              >
                Cheque #{cheque.chequeNumber} — Activity History
              </h3>
              <p className="text-xs text-[#627D98]">
                {cheque.partyName} · {batch?.batchRef || 'Clearing Batch'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#627D98] hover:text-[#102A43] rounded hover:bg-[#D9E2EC]/50 transition-colors"
            aria-label="Close activity drawer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Cheque Snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md text-xs">
            <div>
              <div className="text-[#627D98]">Amount</div>
              <div className="font-mono-num font-bold text-[#102A43] mt-0.5">
                {formatINR(cheque.amount)}
              </div>
            </div>
            <div>
              <div className="text-[#627D98]">Cheque Date</div>
              <div className="font-mono-num font-semibold text-[#102A43] mt-0.5">
                {formatIndianDate(cheque.chequeDate)}
              </div>
            </div>
            <div>
              <div className="text-[#627D98]">Current Status</div>
              <div className="font-semibold text-[#102A43] mt-0.5">
                {cheque.status}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-3 pt-2 border-t border-[#D9E2EC] flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[#627D98]">
              <span>
                Drawee: <strong className="text-[#102A43]">{cheque.draweeBank}</strong> ({cheque.draweeBranch})
              </span>
              {cheque.bounceReason && (
                <span className="text-[#DC2626] font-medium">
                  Return Reason: {cheque.bounceReason}
                </span>
              )}
              {(cheque.recoveredAmount ?? 0) > 0 && (
                <span className="text-[#16A34A] font-medium font-mono-num">
                  Recovered: {formatINR(cheque.recoveredAmount ?? 0)}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#102A43]">
                Chronological Audit Timeline ({logs.length})
              </span>
              <span className="text-[11px] text-[#627D98]">
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
