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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#102A43]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bounce-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-[#D9E2EC] rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA]">
          <div className="flex items-center gap-2.5">
            <AlertOctagon className="w-5 h-5 text-[#DC2626]" aria-hidden="true" />
            <h3 id="bounce-modal-title" className="text-base font-semibold text-[#102A43]">
              Record Cheque Return / Dishonour
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#627D98] hover:text-[#102A43] rounded hover:bg-[#D9E2EC]/50 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="p-3.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md text-xs text-[#243B53] space-y-1">
            <div className="flex justify-between gap-4">
              <span className="font-medium text-[#102A43]">{cheque.partyName}</span>
              <span className="font-mono-num font-semibold text-[#102A43]">
                {formatINR(cheque.amount)}
              </span>
            </div>
            <div className="text-[#627D98] flex items-center gap-2">
              <span className="font-mono-num">Chq #{cheque.chequeNumber}</span>
              <span>·</span>
              <span>{cheque.draweeBank}</span>
              <span>·</span>
              <span>{cheque.invoiceRef || 'No Invoice Ref'}</span>
            </div>
          </div>

          <div className="space-y-2.5">
            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1.5">
                Reason of Return (RBI Return Code / Custom)
              </label>
              <select
                value={selectedPreset}
                onChange={(e) => setSelectedPreset(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
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
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Specify Custom Reason of Return <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="text"
                  value={customReason}
                  onChange={(e) => setCustomReason(e.target.value)}
                  placeholder="e.g. Refer to Drawer / Drawers Sign Incomplete"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  required
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1.5">
                Return Memo Date
              </label>
              <input
                type="date"
                value={bouncedDate}
                onChange={(e) => setBouncedDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                required
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1.5">
                Bank Return Penalty (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={penaltyAmount}
                onChange={(e) => setPenaltyAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                placeholder="750.00"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#243B53] mb-1.5">
              Recovery / Legal Follow-up Remarks
            </label>
            <textarea
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g., Intimated customer accounts team; RTGS replacement requested under Sec 138 notice..."
              className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#D9E2EC]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-[#DC2626] rounded-md hover:bg-[#B91C1C] transition-colors"
            >
              Mark Returned / Bounced
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
