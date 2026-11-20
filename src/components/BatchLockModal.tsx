import React, { useState } from 'react';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { ClearingBatch } from '../types/treasury';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';

interface BatchLockModalProps {
  mode: 'lock' | 'unlock';
  batch: ClearingBatch;
  chequeCount: number;
  batchTotalAmount: number;
  corporateCheckerPassword: string;
  onConfirmLock: (password: string, actorName: string) => void;
  onConfirmUnlock: (
    actorRole: 'Maker' | 'Checker',
    actorName: string,
    reason: string
  ) => void;
  onClose: () => void;
}

export function BatchLockModal({
  mode,
  batch,
  chequeCount,
  batchTotalAmount,
  corporateCheckerPassword,
  onConfirmLock,
  onConfirmUnlock,
  onClose,
}: BatchLockModalProps) {
  const defaultPwd = corporateCheckerPassword || 'TREASURY2026';

  // Lock state
  const [lockPassword, setLockPassword] = useState(defaultPwd);
  const [showLockPwd, setShowLockPwd] = useState(false);

  // Unlock (Bypass) state
  const [actorRole, setActorRole] = useState<'Checker' | 'Maker'>('Checker');
  const [actorName, setActorName] = useState(batch.checkerName || '');
  const [bypassPassword, setBypassPassword] = useState('');
  const [showBypassPwd, setShowBypassPwd] = useState(false);
  const [bypassReason, setBypassReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleLockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!batch.makerName.trim() || !batch.checkerName.trim()) {
      setError(
        'Both Prepared By (Maker) and Verified By (Checker) fields must be filled before locking this batch.'
      );
      return;
    }
    if (lockPassword.trim().length < 4) {
      setError('Authorization password must be at least 4 characters.');
      return;
    }

    onConfirmLock(lockPassword.trim(), batch.checkerName.trim());
  };

  const handleUnlockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const expectedPassword = batch.lockPassword || defaultPwd;
    if (bypassPassword.trim() !== expectedPassword) {
      setError(
        'Invalid Maker/Checker authorization password. Batch remains locked.'
      );
      return;
    }
    if (!actorName.trim()) {
      setError('Enter the authorizing officer name for the audit trail.');
      return;
    }
    if (bypassReason.trim().length < 5) {
      setError(
        'Provide a brief audit reason (minimum 5 characters) for unlocking this batch.'
      );
      return;
    }

    onConfirmUnlock(actorRole, actorName.trim(), bypassReason.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#102A43]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-lock-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-[#D9E2EC] rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA]">
          <div className="flex items-center gap-2.5">
            {mode === 'lock' ? (
              <Lock className="w-4 h-4 text-[#D4AF37]" aria-hidden="true" />
            ) : (
              <KeyRound className="w-4 h-4 text-[#B45309]" aria-hidden="true" />
            )}
            <h3
              id="batch-lock-modal-title"
              className="text-base font-semibold text-[#102A43]"
            >
              {mode === 'lock'
                ? 'Approve & Lock Batch for Print Integrity'
                : 'Maker / Checker Password Bypass'}
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

        {mode === 'lock' ? (
          <form onSubmit={handleLockSubmit} className="p-6 space-y-4">
            <div className="p-3.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md text-xs space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="font-mono-num font-semibold text-[#102A43]">
                  {batch.batchRef}
                </span>
                <span className="font-mono-num text-[#627D98]">
                  {formatIndianDate(batch.depositDate)}
                </span>
              </div>
              <div className="flex items-center justify-between text-[#243B53]">
                <span>{chequeCount} Instruments</span>
                <span className="font-mono-num font-semibold text-[#102A43]">
                  {formatINR(batchTotalAmount)}
                </span>
              </div>
              <div className="pt-1.5 border-t border-[#D9E2EC] text-[#627D98] space-y-0.5">
                <div>
                  Maker: <strong className="text-[#102A43]">{batch.makerName || '—'}</strong>
                </div>
                <div>
                  Checker: <strong className="text-[#102A43]">{batch.checkerName || '—'}</strong>
                </div>
              </div>
            </div>

            <div className="p-3 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md text-xs text-[#102A43] flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
              <span>
                Once locked, all batch metadata, cheque amounts, entries, deletions, and clearing statuses become strictly <strong>read-only</strong> to guarantee print integrity. Modifying any record will require the Maker/Checker password bypass.
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1.5">
                Checker Unlock / Bypass Password
              </label>
              <div className="relative">
                <input
                  type={showLockPwd ? 'text' : 'password'}
                  value={lockPassword}
                  onChange={(e) => setLockPassword(e.target.value)}
                  className="w-full pl-3 pr-10 py-2 text-sm font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  placeholder="Enter password to protect this batch"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowLockPwd((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#627D98] hover:text-[#102A43] p-1"
                  aria-label={showLockPwd ? 'Hide password' : 'Show password'}
                >
                  {showLockPwd ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-[#627D98]">
                Pre-filled with your Corporate Checker Password (<span className="font-mono-num text-[#102A43]">{defaultPwd}</span>). You may customize it for this batch.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-md text-xs text-[#DC2626] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

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
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] transition-colors"
              >
                <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Confirm &amp; Lock Batch</span>
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleUnlockSubmit} className="p-6 space-y-4">
            <div className="p-3.5 bg-[#F59E0B]/10 border border-[#F59E0B]/35 rounded-md text-xs text-[#102A43] space-y-1">
              <div className="font-semibold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[#B45309]" />
                <span>Batch {batch.batchRef} is Read-Only Locked</span>
              </div>
              <div className="text-[#243B53]">
                Locked by {batch.lockedBy || batch.checkerName || 'Checker'}
                {batch.lockedAt
                  ? ` on ${new Date(batch.lockedAt).toLocaleString('en-IN')}`
                  : ''}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Authorizing Role
                </label>
                <select
                  value={actorRole}
                  onChange={(e) => {
                    const role = e.target.value as 'Checker' | 'Maker';
                    setActorRole(role);
                    setActorName(
                      role === 'Checker' ? batch.checkerName : batch.makerName
                    );
                  }}
                  className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                >
                  <option value="Checker">Checker Authorization</option>
                  <option value="Maker">Maker Authorization</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Authorizing Officer Name
                </label>
                <input
                  type="text"
                  value={actorName}
                  onChange={(e) => setActorName(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1">
                Maker / Checker Password <span className="text-[#DC2626]">*</span>
              </label>
              <div className="relative">
                <input
                  type={showBypassPwd ? 'text' : 'password'}
                  value={bypassPassword}
                  onChange={(e) => setBypassPassword(e.target.value)}
                  placeholder="Enter authorization password"
                  className="w-full pl-3 pr-10 py-2 text-sm font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  autoFocus
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowBypassPwd((v) => !v)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#627D98] hover:text-[#102A43] p-1"
                  aria-label={showBypassPwd ? 'Hide password' : 'Show password'}
                >
                  {showBypassPwd ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="mt-1 text-[11px] text-[#627D98]">
                Default Corporate Checker Password: <strong className="font-mono-num text-[#102A43]">{defaultPwd}</strong> (unless customized when locking · configurable in Company Settings).
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1">
                Audit Reason for Unlock / Bypass <span className="text-[#DC2626]">*</span>
              </label>
              <textarea
                rows={2}
                value={bypassReason}
                onChange={(e) => setBypassReason(e.target.value)}
                placeholder="e.g., Correct cheque number typo before physical deposit at Fort Branch"
                className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                required
              />
            </div>

            {error && (
              <div className="p-3 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-md text-xs text-[#DC2626] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#D9E2EC]">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
              >
                Keep Batch Locked
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#B45309] rounded-md hover:bg-[#92400E] transition-colors"
              >
                <Unlock className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Verify Password &amp; Unlock</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
