import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BellOff,
  CheckCircle2,
  ClipboardList,
  Clock,
  Landmark,
  X,
} from 'lucide-react';
import { formatINR } from '../utils/indianCurrency';
import {
  formatExactElapsedDuration,
  formatVerboseElapsedDuration,
  OverdueChequeAlertItem,
} from '../utils/returnedChequeAlerts';

interface OverdueReturnedChequeModalProps {
  items: OverdueChequeAlertItem[];
  showCompanyBadge?: boolean;
  onMarkCollected: (companyId: string, chequeId: string) => void;
  onSnoozeTenMinutes: () => void;
  onViewInFieldChecklist: (item: OverdueChequeAlertItem) => void;
}

export function OverdueReturnedChequeModal({
  items,
  showCompanyBadge = false,
  onMarkCollected,
  onSnoozeTenMinutes,
  onViewInFieldChecklist,
}: OverdueReturnedChequeModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setLiveNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedIndex >= items.length) {
      setSelectedIndex(0);
    }
  }, [items.length, selectedIndex]);

  if (items.length === 0) return null;

  const activeItem = items[selectedIndex] || items[0];
  const liveElapsedMs = Math.max(0, liveNowMs - activeItem.returnUpdatedMs);
  const formattedReturnTimestamp = new Date(
    activeItem.returnUpdatedMs
  ).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#102A43]/70 backdrop-blur-[2px] p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="overdue-cheque-alert-title"
    >
      <div className="w-full max-w-2xl bg-white border-2 border-[#DC2626] rounded-lg shadow-2xl overflow-hidden">
        {/* Urgent Header */}
        <div className="px-5 py-3.5 bg-[#DC2626] text-white flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center shrink-0 mt-0.5">
              <AlertTriangle className="w-4 h-4 text-white" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2
                id="overdue-cheque-alert-title"
                className="text-sm sm:text-base font-bold tracking-tight leading-snug"
              >
                ⚠️ URGENT: Returned Cheque Uncollected (12+ Hrs Overdue)
              </h2>
              <p className="text-[11px] text-red-100 mt-0.5">
                Physical cheque or recovery remains uncollected past the 12-hour SLA. Repeating every 10 minutes until resolved.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onSnoozeTenMinutes}
            title="Snooze for 10 Mins"
            aria-label="Snooze for 10 Mins"
            className="p-1.5 text-red-100 hover:text-white hover:bg-white/15 rounded transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Multi-cheque queue strip when >1 overdue cheque requires attention */}
        {items.length > 1 && (
          <div className="px-5 py-2.5 bg-[#F4F7FA] border-b border-[#D9E2EC] flex items-center gap-2 overflow-x-auto">
            <span className="text-[11px] font-semibold text-[#DC2626] whitespace-nowrap shrink-0">
              {items.length} Overdue Instruments:
            </span>
            <div className="flex items-center gap-1.5">
              {items.map((entry, idx) => {
                const isSelected = idx === selectedIndex;
                const entryElapsed = Math.max(0, liveNowMs - entry.returnUpdatedMs);
                return (
                  <button
                    key={`${entry.companyId}-${entry.cheque.id}`}
                    type="button"
                    onClick={() => setSelectedIndex(idx)}
                    className={`px-2.5 py-1 rounded text-[11px] font-mono-num whitespace-nowrap border transition-colors ${
                      isSelected
                        ? 'bg-[#102A43] text-white border-[#102A43] font-semibold'
                        : 'bg-white text-[#243B53] border-[#D9E2EC] hover:border-[#DC2626]/50'
                    }`}
                  >
                    #{entry.cheque.chequeNumber} · {formatExactElapsedDuration(entryElapsed)}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Primary Overdue Cheque Details */}
        <div className="p-5 space-y-4">
          {/* Live Elapsed Timer Strip */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 bg-[#DC2626]/8 border border-[#DC2626]/30 rounded-md">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded bg-[#DC2626] text-white text-[11px] font-bold uppercase tracking-wide overdue-blink-badge">
                12+ Hrs Overdue
              </span>
              <span className="text-xs font-medium text-[#243B53]">
                Elapsed since Return Update:
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-sm font-bold text-[#DC2626] font-mono-num">
              <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{formatVerboseElapsedDuration(liveElapsedMs)}</span>
            </div>
          </div>

          {/* Core Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md p-4">
            <div>
              <div className="text-[11px] font-medium text-[#627D98] uppercase tracking-wider">
                Customer Name
              </div>
              <div className="mt-1 text-sm font-bold text-[#102A43]">
                {activeItem.cheque.partyName}
              </div>
              <div className="text-[11px] text-[#627D98] font-mono-num mt-0.5">
                {activeItem.cheque.customerCode || 'Customer'}
                {showCompanyBadge ? ` · ${activeItem.companyName}` : ''}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-[#627D98] uppercase tracking-wider">
                Cheque Number
              </div>
              <div className="mt-1 text-sm font-bold text-[#176B87] font-mono-num">
                #{activeItem.cheque.chequeNumber}
              </div>
              <div className="text-[11px] text-[#627D98] font-mono-num mt-0.5">
                Batch: {activeItem.batchRef} · Drawn on {activeItem.cheque.draweeBank}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-[#627D98] uppercase tracking-wider">
                Amount (₹)
              </div>
              <div className="mt-1 text-lg font-bold text-[#102A43] font-mono-num">
                {formatINR(activeItem.cheque.amount)}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-medium text-[#627D98] uppercase tracking-wider">
                Return Reason
              </div>
              <div className="mt-1 text-sm font-semibold text-[#DC2626]">
                {activeItem.cheque.bounceReason?.trim() || 'Reason Not Specified'}
              </div>
              <div className="text-[11px] text-[#627D98] font-mono-num mt-0.5">
                Return Logged: {formattedReturnTimestamp}
              </div>
            </div>

            <div className="sm:col-span-2 pt-2 border-t border-[#D9E2EC] flex flex-wrap items-center gap-2 text-xs text-[#243B53]">
              <Landmark className="w-3.5 h-3.5 text-[#176B87] shrink-0" aria-hidden="true" />
              <span className="text-[#627D98]">Pickup Bank &amp; Branch:</span>
              <span className="font-semibold text-[#102A43]">
                {activeItem.depositBank} — {activeItem.depositBranch}
              </span>
            </div>
          </div>

          {/* Footer Action Buttons */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-2 border-t border-[#D9E2EC]">
            <button
              type="button"
              onClick={onSnoozeTenMinutes}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
            >
              <BellOff className="w-3.5 h-3.5 text-[#627D98]" aria-hidden="true" />
              <span>Snooze for 10 Mins</span>
            </button>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <button
                type="button"
                onClick={() => onViewInFieldChecklist(activeItem)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] hover:text-white transition-colors"
              >
                <ClipboardList className="w-3.5 h-3.5" aria-hidden="true" />
                <span>View in Field Checklist</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  onMarkCollected(activeItem.companyId, activeItem.cheque.id)
                }
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#16A34A] rounded-md hover:bg-[#15803D] transition-colors shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Mark as Collected / Received</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
