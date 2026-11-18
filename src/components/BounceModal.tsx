import React, { useState } from 'react';
import { X, AlertOctagon } from 'lucide-react';
import { BOUNCE_REASONS } from '../data/indianBanks';
import { ChequeEntry } from '../types/treasury';
import { formatINR } from '../utils/indianCurrency';

interface BounceModalProps {
  cheque: ChequeEntry;
  onConfirm: (data: {
    bounceReason: string;
    penaltyAmount: number;
    bouncedDate: string;
    remarks: string;
  }) => void;
  onClose: () => void;
}

const CUSTOM_OPTION = '__CUSTOM__';

export function BounceModal({ cheque, onConfirm, onClose }: BounceModalProps) {
  const initialReason = cheque.bounceReason || BOUNCE_REASONS[0];
  const isInitialPreset = BOUNCE_REASONS.includes(initialReason);
  const [selectedPreset, setSelectedPreset] = useState(
    isInitialPreset ? initialReason : CUSTOM_OPTION
  );
  const [customReason, setCustomReason] = useState(
    isInitialPreset ? '' : initialReason
  );
  const [penaltyAmount, setPenaltyAmount] = useState(
    cheque.penaltyAmount !== undefined ? String(cheque.penaltyAmount) : '750'
  );
  const [bouncedDate, setBouncedDate] = useState(
    cheque.bouncedDate || new Date().toISOString().slice(0, 10)
  );
  const [remarks, setRemarks] = useState(cheque.remarks || '');

  const resolvedReason =
    selectedPreset === CUSTOM_OPTION ? customReason.trim() : selectedPreset;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedReason) return;
    const parsedPenalty = parseFloat(penaltyAmount) || 0;
    onConfirm({
      bounceReason: resolvedReason,
      penaltyAmount: Math.max(0, parsedPenalty),
      bouncedDate,
      remarks: remarks.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bounce-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="w-5 h-5 text-red-700" aria-hidden="true" />
            <h3 id="bounce-modal-title" className="text-base font-semibold text-slate-900">
              Record Cheque Return / Dishonour
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded hover:bg-slate-200/60 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 space-y-1">
            <div className="flex justify-between gap-4">
              <span className="font-medium text-slate-900">{cheque.partyName}</span>
              <span className="font-mono-num font-semibold text-slate-900">
                {formatINR(cheque.amount)}
              </span>
            </div>
            <div className="text-slate-500 flex items-center gap-2">
              <span className="font-mono-num">Chq #{cheque.chequeNumber}</span>
              <span>·</span>
              <span>{cheque.draweeBank}</span>
              <span>·</span>
              <span>{cheque.invoiceRef || 'No Invoice Ref'}</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Reason of Return (RBI Return Code / Custom)
              </label>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                required
              >
                {BOUNCE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
                <option value={CUSTOM_OPTION}>
                  Custom / Other Reason (Specify below)
                </option>
              </select>
            </div>

            {selectedPreset === CUSTOM_OPTION && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Specify Custom Reason of Return <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="e.g. Refer to Drawer / Drawers Sign Incomplete"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                  required
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Return Memo Date
              </label>
              <input
                type="date"
                value={bouncedDate}
                onChange={(e) => setBouncedDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1.5">
                Bank Return Penalty (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={penaltyAmount}
                onChange={(e) => setPenaltyAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
                placeholder="750.00"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1.5">
              Recovery / Legal Follow-up Remarks
            </label>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g., Intimated customer accounts team; RTGS replacement requested under Sec 138 notice..."
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-900"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium text-white bg-red-700 rounded-md hover:bg-red-800 transition-colors"
            >
              Mark Returned / Bounced
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
