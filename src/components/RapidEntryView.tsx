import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Edit3,
  History,
  Keyboard,
  Lock,
  Plus,
  Trash2,
  Unlock,
  X,
} from 'lucide-react';
import { MAJOR_INDIAN_BANKS } from '../data/indianBanks';
import { findDuplicateCheque } from '../services/treasuryStore';
import {
  ChequeEntry,
  ChequeStatus,
  ClearingBatch,
  ClearingType,
  CompanyBankAccount,
  SystemAuditLogEntry,
} from '../types/treasury';
import {
  evaluateChequeDate,
  formatIndianDate,
  formatINR,
  numberToIndianWords,
} from '../utils/indianCurrency';
import { ActivityTimeline } from './ActivityTimeline';
import { StatusTag } from './StatusTag';

interface RapidEntryViewProps {
  batches: ClearingBatch[];
  activeBatchId: string;
  bankAccounts: CompanyBankAccount[];
  allCheques: ChequeEntry[];
  editingCheque: ChequeEntry | null;
  auditLogs?: SystemAuditLogEntry[];
  onCancelEdit: () => void;
  onSaveCheque: (
    payload: Omit<ChequeEntry, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => void;
  onDeleteCheque: (chequeId: string) => void;
  onStartEdit: (cheque: ChequeEntry) => void;
}

const CLEARING_TYPES: ClearingType[] = [
  'High-Value Clearing',
  'Local CTS Clearing',
  'Same-Bank Transfer',
  'Outstation',
];

export function RapidEntryView({
  batches,
  activeBatchId,
  bankAccounts,
  allCheques,
  editingCheque,
  auditLogs = [],
  onCancelEdit,
  onSaveCheque,
  onDeleteCheque,
  onStartEdit,
}: RapidEntryViewProps) {
  const activeBatch = useMemo(
    () => batches.find((b) => b.id === activeBatchId) || batches[0],
    [batches, activeBatchId]
  );

  const [batchId, setBatchId] = useState(activeBatch?.id || '');
  const [companyBankAccountId, setCompanyBankAccountId] = useState(
    activeBatch?.companyBankAccountId || bankAccounts[0]?.id || ''
  );
  const [chequeDate, setChequeDate] = useState(
    activeBatch?.depositDate || '2026-11-17'
  );
  const [chequeNumber, setChequeNumber] = useState('');
  const [draweeBank, setDraweeBank] = useState('');
  const [draweeBranch, setDraweeBranch] = useState('');
  const [clearingType, setClearingType] = useState<ClearingType>('Local CTS Clearing');
  const [clearingManuallySet, setClearingManuallySet] = useState(false);
  const [partyName, setPartyName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [invoiceRef, setInvoiceRef] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [chequeStatus, setChequeStatus] = useState<ChequeStatus>('Draft');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [lastSavedNotice, setLastSavedNotice] = useState<string | null>(null);

  // Refs for Enter-key rapid keyboard traversal
  const fieldRefs = {
    bankAccount: useRef<HTMLSelectElement>(null),
    chequeDate: useRef<HTMLInputElement>(null),
    chequeNumber: useRef<HTMLInputElement>(null),
    draweeBank: useRef<HTMLInputElement>(null),
    draweeBranch: useRef<HTMLInputElement>(null),
    clearingType: useRef<HTMLSelectElement>(null),
    partyName: useRef<HTMLInputElement>(null),
    customerCode: useRef<HTMLInputElement>(null),
    invoiceRef: useRef<HTMLInputElement>(null),
    amount: useRef<HTMLInputElement>(null),
  };

  // Sync when editing an existing cheque
  useEffect(() => {
    if (editingCheque) {
      setBatchId(editingCheque.batchId);
      setCompanyBankAccountId(editingCheque.companyBankAccountId);
      setChequeDate(editingCheque.chequeDate);
      setChequeNumber(editingCheque.chequeNumber);
      setDraweeBank(editingCheque.draweeBank);
      setDraweeBranch(editingCheque.draweeBranch);
      setClearingType(editingCheque.clearingType);
      setClearingManuallySet(true);
      setPartyName(editingCheque.partyName);
      setCustomerCode(editingCheque.customerCode);
      setInvoiceRef(editingCheque.invoiceRef);
      setAmountInput(String(editingCheque.amount));
      setChequeStatus(editingCheque.status);
      setRemarks(editingCheque.remarks || '');
      setFormError(null);
      const batchForEdit = batches.find((b) => b.id === editingCheque.batchId);
      if (!batchForEdit?.isLocked) {
        fieldRefs.chequeDate.current?.focus();
      }
    }
  }, [editingCheque, batches]);

  const selectedBatch = batches.find((b) => b.id === batchId) || activeBatch;
  const selectedDepositAcc = bankAccounts.find((a) => a.id === companyBankAccountId);
  const isLocked = Boolean(selectedBatch?.isLocked);

  const parsedAmount = useMemo(() => {
    const cleaned = amountInput.replace(/,/g, '').trim();
    const num = parseFloat(cleaned);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }, [amountInput]);

  // Smart Clearing Type auto-suggestion when user hasn't manually overridden
  useEffect(() => {
    if (clearingManuallySet || editingCheque) return;
    const depositBankPrefix = selectedDepositAcc?.bankName
      .split(' ')[0]
      .toLowerCase();
    const draweePrefix = draweeBank.trim().toLowerCase();

    if (depositBankPrefix && draweePrefix.includes(depositBankPrefix)) {
      setClearingType('Same-Bank Transfer');
    } else if (parsedAmount >= 200000) {
      setClearingType('High-Value Clearing');
    } else {
      setClearingType('Local CTS Clearing');
    }
  }, [
    draweeBank,
    parsedAmount,
    selectedDepositAcc,
    clearingManuallySet,
    editingCheque,
  ]);

  // Live Date Compliance Evaluation (Stale > 90d, PDC)
  const dateEvaluation = useMemo(
    () => evaluateChequeDate(chequeDate, selectedBatch?.depositDate || '2026-11-17'),
    [chequeDate, selectedBatch]
  );

  // Live Duplicate Cheque Check
  const duplicateMatch = useMemo(() => {
    if (chequeNumber.length !== 6 || !draweeBank.trim()) return undefined;
    return findDuplicateCheque(
      allCheques,
      chequeNumber,
      draweeBank,
      editingCheque?.id
    );
  }, [allCheques, chequeNumber, draweeBank, editingCheque]);

  const batchCheques = useMemo(
    () =>
      allCheques
        .filter((c) => c.batchId === selectedBatch?.id)
        .slice()
        .reverse(),
    [allCheques, selectedBatch]
  );

  const batchTotal = useMemo(
    () => batchCheques.reduce((sum, c) => sum + c.amount, 0),
    [batchCheques]
  );

  const handleEnterAdvance = (
    e: React.KeyboardEvent,
    nextRef?: React.RefObject<HTMLInputElement | HTMLSelectElement | null>
  ) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nextRef?.current) {
        nextRef.current.focus();
      } else {
        handleSubmit();
      }
    }
  };

  const applyBankPreset = (presetName: string, sampleBranch: string) => {
    setDraweeBank(presetName);
    if (!draweeBranch.trim()) setDraweeBranch(sampleBranch);
    setClearingManuallySet(false);
    fieldRefs.draweeBranch.current?.focus();
  };

  const clearInstrumentFields = () => {
    setChequeNumber('');
    setPartyName('');
    setCustomerCode('');
    setInvoiceRef('');
    setAmountInput('');
    setChequeStatus('Draft');
    setRemarks('');
    setClearingManuallySet(false);
    setFormError(null);
  };

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setFormError(null);

    if (isLocked && !editingCheque) {
      setFormError(
        'Selected batch is locked. Only Status updates on existing instruments are allowed while locked.'
      );
      return;
    }

    if (isLocked && editingCheque) {
      onSaveCheque(
        {
          batchId: editingCheque.batchId,
          companyBankAccountId: editingCheque.companyBankAccountId,
          chequeDate: editingCheque.chequeDate,
          chequeNumber: editingCheque.chequeNumber,
          micrCode: editingCheque.micrCode,
          draweeBank: editingCheque.draweeBank,
          draweeBranch: editingCheque.draweeBranch,
          clearingType: editingCheque.clearingType,
          partyName: editingCheque.partyName,
          customerCode: editingCheque.customerCode,
          invoiceRef: editingCheque.invoiceRef,
          amount: editingCheque.amount,
          status: chequeStatus,
          bounceReason: editingCheque.bounceReason,
          penaltyAmount: editingCheque.penaltyAmount,
          bouncedDate: editingCheque.bouncedDate,
          clearedDate:
            chequeStatus === 'Cleared'
              ? editingCheque.clearedDate || new Date().toISOString().slice(0, 10)
              : editingCheque.clearedDate,
          remarks: editingCheque.remarks,
        },
        editingCheque.id
      );
      setLastSavedNotice(
        `Updated status of Chq #${editingCheque.chequeNumber} to "${chequeStatus}"`
      );
      onCancelEdit();
      clearInstrumentFields();
      return;
    }

    if (!/^\d{6}$/.test(chequeNumber.trim())) {
      setFormError('Cheque Number must be strictly 6 numeric digits (e.g. 482910).');
      fieldRefs.chequeNumber.current?.focus();
      return;
    }
    if (!draweeBank.trim()) {
      setFormError('Drawee Bank Name is required.');
      fieldRefs.draweeBank.current?.focus();
      return;
    }
    if (!partyName.trim()) {
      setFormError('Party / Customer Name is required.');
      fieldRefs.partyName.current?.focus();
      return;
    }
    if (parsedAmount <= 0) {
      setFormError('Enter a valid cheque amount greater than ₹0.00.');
      fieldRefs.amount.current?.focus();
      return;
    }

    onSaveCheque(
      {
        batchId: selectedBatch?.id || batchId,
        companyBankAccountId,
        chequeDate,
        chequeNumber: chequeNumber.trim(),
        micrCode: editingCheque?.micrCode || '',
        draweeBank: draweeBank.trim(),
        draweeBranch: draweeBranch.trim() || 'Main Branch',
        clearingType,
        partyName: partyName.trim(),
        customerCode: customerCode.trim().toUpperCase(),
        invoiceRef: invoiceRef.trim().toUpperCase(),
        amount: Math.round(parsedAmount * 100) / 100,
        status: chequeStatus,
        bounceReason: editingCheque?.bounceReason,
        penaltyAmount: editingCheque?.penaltyAmount,
        bouncedDate: editingCheque?.bouncedDate,
        clearedDate: editingCheque?.clearedDate,
        remarks: remarks.trim() || undefined,
      },
      editingCheque?.id
    );

    const savedBanner = `${
      editingCheque ? 'Updated' : 'Recorded'
    } Chq #${chequeNumber.trim()} (${formatINR(parsedAmount)}) — ${partyName.trim()}`;
    setLastSavedNotice(savedBanner);

    if (editingCheque) {
      onCancelEdit();
    }
    clearInstrumentFields();
    setTimeout(() => {
      fieldRefs.chequeNumber.current?.focus();
    }, 30);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      {/* Left: High-Speed Keyboard-First Entry Form */}
      <section className="xl:col-span-7 bg-white border border-[#D9E2EC] rounded-lg shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-[#102A43]">
              {editingCheque
                ? `Edit Cheque #${editingCheque.chequeNumber}`
                : 'High-Speed Cheque Entry'}
            </h2>
            <p className="text-xs text-[#627D98] mt-0.5 flex items-center gap-1.5">
              <Keyboard className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
              <span>Press Enter to advance fields · Auto-validates 6-digit Chq, PDC &amp; Stale</span>
            </p>
          </div>
          {editingCheque && (
            <button
              type="button"
              onClick={() => {
                onCancelEdit();
                clearInstrumentFields();
              }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              <span>Cancel Edit</span>
            </button>
          )}
        </div>

        {isLocked && (
          <div className="mx-6 mt-5 p-3.5 bg-[#F59E0B]/10 border border-[#F59E0B]/35 rounded-md text-xs text-[#102A43] flex items-center gap-2.5">
            <Lock className="w-4 h-4 text-[#B45309] shrink-0" />
            <span>
              Batch <strong>{selectedBatch?.batchRef}</strong> is currently locked by Checker. Core fields, amounts, and adding new instruments are disabled;{' '}
              {editingCheque
                ? 'you can still update the Status below and save.'
                : 'select an existing item from the Batch Queue or Dashboard to update its Status.'}
            </span>
          </div>
        )}

        {lastSavedNotice && (
          <div className="mx-6 mt-5 p-3 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md text-xs text-[#102A43] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
              <span>{lastSavedNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setLastSavedNotice(null)}
              className="text-[#16A34A] hover:text-[#102A43]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {formError && (
          <div className="mx-6 mt-5 p-3 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-md text-xs text-[#DC2626] flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-[#DC2626] shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Row 1: Batch & Deposit Account */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && editingCheque && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>Clearing Batch</span>
              </label>
              <select
                disabled={isLocked && Boolean(editingCheque)}
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono-num font-medium border border-[#D9E2EC] rounded-md bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              >
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batchRef} ({formatIndianDate(b.depositDate)})
                    {b.isLocked ? ' — LOCKED' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>Credit To Company Bank Account</span>
              </label>
              <select
                ref={fieldRefs.bankAccount}
                disabled={isLocked}
                value={companyBankAccountId}
                onChange={(e) => setCompanyBankAccountId(e.target.value)}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.chequeDate)}
                className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              >
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} — {acc.accountType} ({acc.accountNumber})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset disabled={isLocked} className="space-y-5 disabled:opacity-70">

          {/* Row 2: Cheque Date & Cheque No (6) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>
                  Cheque Date <span className="text-[#DC2626]">*</span>
                </span>
              </label>
              <input
                ref={fieldRefs.chequeDate}
                type="date"
                value={chequeDate}
                onChange={(e) => setChequeDate(e.target.value)}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.chequeNumber)}
                className={`w-full px-3 py-2 text-sm font-mono-num border rounded-md bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87] ${
                  dateEvaluation.flag !== 'VALID'
                    ? 'border-[#F59E0B] bg-[#F59E0B]/5'
                    : 'border-[#D9E2EC]'
                }`}
                required
              />
              <div
                className={`mt-1 text-[11px] font-medium ${
                  dateEvaluation.flag === 'STALE'
                    ? 'text-[#DC2626]'
                    : dateEvaluation.flag === 'PDC'
                    ? 'text-[#B45309]'
                    : 'text-[#627D98]'
                }`}
              >
                {dateEvaluation.message}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>
                  Cheque Number (6 Digits) <span className="text-[#DC2626]">*</span>
                </span>
              </label>
              <input
                ref={fieldRefs.chequeNumber}
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={chequeNumber}
                onChange={(e) =>
                  setChequeNumber(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.draweeBank)}
                placeholder="e.g. 482910"
                className={`w-full px-3 py-2 text-sm font-mono-num tracking-wider border rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87] ${
                  duplicateMatch
                    ? 'border-[#DC2626] bg-[#DC2626]/5'
                    : 'border-[#D9E2EC]'
                }`}
                required
              />
              <div className="mt-1 text-[11px]">
                {duplicateMatch ? (
                  <span className="font-semibold text-[#DC2626]">
                    Duplicate Alert: Chq #{duplicateMatch.chequeNumber} already logged for{' '}
                    {duplicateMatch.partyName}
                  </span>
                ) : (
                  <span className="text-[#627D98]">
                    {chequeNumber.length}/6 digits
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Compliance Callout if PDC or Stale or Duplicate */}
          {(dateEvaluation.flag !== 'VALID' || duplicateMatch) && (
            <div className="p-3.5 bg-[#F59E0B]/10 border border-[#F59E0B]/35 rounded-md text-xs text-[#102A43] flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#B45309] shrink-0 mt-0.5" />
              <div className="space-y-1">
                {dateEvaluation.flag === 'PDC' && (
                  <div>
                    <strong>Post-Dated Cheque (PDC) Detected:</strong> Cheque date (
                    {formatIndianDate(chequeDate)}) is ahead of batch deposit date (
                    {formatIndianDate(selectedBatch?.depositDate || '')}). It will be flagged as PDC Hold and automatically excluded from today&apos;s Bank Deposit Memo unless overridden.
                  </div>
                )}
                {dateEvaluation.flag === 'STALE' && (
                  <div>
                    <strong>Stale Cheque Warning:</strong> Exceeds 90-day RBI clearing window. Banks will reject stale instruments under Reason Code 16.
                  </div>
                )}
                {duplicateMatch && (
                  <div className="text-[#DC2626]">
                    <strong>Duplicate Instrument Warning:</strong> Cheque #{duplicateMatch.chequeNumber} drawn on {duplicateMatch.draweeBank} already exists in the ledger ({formatINR(duplicateMatch.amount)}).
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick-Select Major Indian Bank Presets */}
          <div>
            <div className="text-xs font-medium text-[#243B53] mb-1.5">
              Quick-Select Drawee Bank Preset
            </div>
            <div className="flex flex-wrap gap-1.5">
              {MAJOR_INDIAN_BANKS.map((bank) => {
                const active = draweeBank === bank.name;
                return (
                  <button
                    key={bank.shortCode}
                    type="button"
                    onClick={() =>
                      applyBankPreset(bank.name, bank.sampleBranch)
                    }
                    className={`px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-[#102A43] text-white border-[#102A43]'
                        : 'bg-[#F4F7FA] text-[#243B53] border-[#D9E2EC] hover:border-[#176B87] hover:text-[#102A43]'
                    }`}
                  >
                    {bank.shortCode}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Row 3: Drawee Bank, Branch, Clearing Type */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>
                  Drawee Bank Name <span className="text-[#DC2626]">*</span>
                </span>
              </label>
              <input
                ref={fieldRefs.draweeBank}
                type="text"
                value={draweeBank}
                onChange={(e) => {
                  setDraweeBank(e.target.value);
                  setClearingManuallySet(false);
                }}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.draweeBranch)}
                placeholder="e.g. HDFC Bank Ltd."
                className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                required
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>Drawee Branch</span>
              </label>
              <input
                ref={fieldRefs.draweeBranch}
                type="text"
                value={draweeBranch}
                onChange={(e) => setDraweeBranch(e.target.value)}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.clearingType)}
                placeholder="e.g. Nariman Point, Mumbai"
                className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>Clearing Type</span>
              </label>
              <select
                ref={fieldRefs.clearingType}
                value={clearingType}
                onChange={(e) => {
                  setClearingType(e.target.value as ClearingType);
                  setClearingManuallySet(true);
                }}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.partyName)}
                className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              >
                {CLEARING_TYPES.map((ct) => (
                  <option key={ct} value={ct}>
                    {ct}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 4: Party Name, Customer Code, Invoice Ref */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
            <div className="md:col-span-6">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>
                  Party / Customer Name <span className="text-[#DC2626]">*</span>
                </span>
              </label>
              <input
                ref={fieldRefs.partyName}
                type="text"
                value={partyName}
                onChange={(e) => setPartyName(e.target.value)}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.customerCode)}
                placeholder="e.g. Larsen & Toubro Heavy Engg. Ltd."
                className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                required
              />
            </div>

            <div className="md:col-span-3">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>Customer Code</span>
              </label>
              <input
                ref={fieldRefs.customerCode}
                type="text"
                value={customerCode}
                onChange={(e) => setCustomerCode(e.target.value)}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.invoiceRef)}
                placeholder="CUST-042"
                className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>

            <div className="md:col-span-3">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                {isLocked && (
                  <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                )}
                <span>Invoice / Ref No.</span>
              </label>
              <input
                ref={fieldRefs.invoiceRef}
                type="text"
                value={invoiceRef}
                onChange={(e) => setInvoiceRef(e.target.value)}
                onKeyDown={(e) => handleEnterAdvance(e, fieldRefs.amount)}
                placeholder="INV/26-27/4450"
                className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>
          </div>

          {/* Row 5: Amount (₹) with live Indian numbering & words */}
          <div className="p-4 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md space-y-2.5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-end">
              <div>
                <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
                  {isLocked && (
                    <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
                  )}
                  <span>
                    Cheque Amount (₹ INR) <span className="text-[#DC2626]">*</span>
                  </span>
                </label>
                <input
                  ref={fieldRefs.amount}
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  onKeyDown={(e) => handleEnterAdvance(e)}
                  placeholder="e.g. 124560000.00"
                  className="w-full px-3 py-2.5 text-base font-mono-num font-semibold border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  required
                />
              </div>

              <div className="pb-1">
                <div className="text-[11px] font-medium text-[#627D98]">
                  Formatted Indian Notation
                </div>
                <div className="text-xl font-bold font-mono-num text-[#102A43]">
                  {formatINR(parsedAmount)}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-[#D9E2EC] text-xs text-[#243B53]">
              <span className="font-medium text-[#627D98]">In Words: </span>
              <span className="font-medium text-[#102A43]">
                {numberToIndianWords(parsedAmount)}
              </span>
            </div>
          </div>

          <div>
            <label className="flex items-center gap-1.5 text-xs font-medium text-[#243B53] mb-1">
              {isLocked && (
                <Lock className="w-3 h-3 text-[#627D98] shrink-0" aria-hidden="true" />
              )}
              <span>Treasury Remarks (Optional)</span>
            </label>
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Advance against PO #9921 or Hold until PDC maturity"
              className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] disabled:bg-[#F4F7FA] disabled:text-[#627D98] disabled:border-[#D9E2EC] disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
            />
          </div>
          </fieldset>

          {/* Status Field — Always Unlocked & Editable Even When Batch Is Locked */}
          <div className="p-4 bg-white border border-[#D9E2EC] rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor="cheque-entry-status"
                  className="text-xs font-semibold text-[#102A43]"
                >
                  Instrument / Clearing Status
                </label>
                {isLocked && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#16A34A]">
                    <Unlock className="w-3 h-3" aria-hidden="true" />
                    <span>Editable While Locked</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-[#627D98] mt-0.5">
                {isLocked && !editingCheque
                  ? 'Select an instrument from the Batch Queue to update its Status.'
                  : 'Update realization lifecycle status at any time without unlocking the batch.'}
              </p>
            </div>
            <select
              id="cheque-entry-status"
              disabled={isLocked && !editingCheque}
              value={chequeStatus}
              onChange={(e) => setChequeStatus(e.target.value as ChequeStatus)}
              className="px-3 py-2 text-xs font-semibold border border-[#D9E2EC] rounded-md bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87] min-w-[190px]"
            >
              <option value="Draft">Draft</option>
              <option value="Submitted to Bank">Submitted to Bank</option>
              <option value="Cleared">Cleared</option>
              <option value="Returned / Bounced">Returned / Bounced</option>
              <option value="Settled / Recovered">Settled / Recovered</option>
              <option value="Re-Deposited">Re-Deposited</option>
            </select>
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-[#D9E2EC]">
            <button
              type="button"
              disabled={isLocked}
              onClick={clearInstrumentFields}
              className="px-4 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Clear Fields
            </button>
            <button
              type="submit"
              disabled={isLocked && !editingCheque}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-xs"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>
                {isLocked && editingCheque
                  ? 'Update Status'
                  : editingCheque
                  ? 'Update Cheque Entry'
                  : 'Save & Enter Next (Enter)'}
              </span>
            </button>
          </div>
        </form>
      </section>

      {/* Right: Live Batch Entry Queue */}
      <section className="xl:col-span-5 bg-white border border-[#D9E2EC] rounded-lg shadow-xs overflow-hidden">
        <div className="px-5 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#102A43]">
              Batch Queue · {selectedBatch?.batchRef}
            </h3>
            <p className="text-xs text-[#627D98] mt-0.5">
              {batchCheques.length} instruments ·{' '}
              <span className="font-mono-num font-semibold text-[#102A43]">
                {formatINR(batchTotal)}
              </span>
            </p>
          </div>
        </div>

        <div className="divide-y divide-[#D9E2EC] max-h-[680px] overflow-y-auto">
          {batchCheques.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#627D98]">
              No cheques entered in this batch yet. Use the keyboard-first form on the left to begin.
            </div>
          ) : (
            batchCheques.map((chq) => {
              const ev = evaluateChequeDate(
                chq.chequeDate,
                selectedBatch?.depositDate || '2026-11-17'
              );
              return (
                <div
                  key={chq.id}
                  className={`p-4 hover:bg-[#F4F7FA] transition-colors ${
                    editingCheque?.id === chq.id ? 'bg-[#14B8A6]/10 border-l-2 border-l-[#14B8A6]' : ''
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#102A43] truncate">
                        {chq.partyName}
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#627D98] flex flex-wrap items-center gap-1.5">
                        <span className="font-mono-num font-medium text-[#243B53]">
                          #{chq.chequeNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{formatIndianDate(chq.chequeDate)}</span>
                        <span aria-hidden="true">·</span>
                        <span>{chq.draweeBank}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-[#627D98]">
                        <span>{chq.clearingType}</span>
                        <span aria-hidden="true">·</span>
                        <StatusTag status={chq.status} />
                        {ev.flag !== 'VALID' && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-[#B45309]">
                              {ev.flag}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-mono-num font-bold text-[#102A43]">
                        {formatINR(chq.amount)}
                      </div>
                      <div className="mt-1.5 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onStartEdit(chq)}
                          title={
                            isLocked
                              ? 'Update Status (Core fields locked)'
                              : 'Edit Cheque'
                          }
                          className="p-1 text-[#627D98] hover:text-[#176B87] rounded hover:bg-[#176B87]/10 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        {isLocked ? (
                          <span
                            title="Batch locked: items cannot be deleted"
                            className="p-1 text-[#D9E2EC] cursor-not-allowed inline-flex items-center"
                          >
                            <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => onDeleteCheque(chq.id)}
                            title="Delete Cheque"
                            className="p-1 text-[#627D98] hover:text-[#DC2626] rounded hover:bg-[#DC2626]/10 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {editingCheque && (
        <section className="xl:col-span-12 bg-white border border-[#D9E2EC] rounded-lg shadow-xs overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#D9E2EC] bg-[#F4F7FA] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-[#176B87]" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-[#102A43]">
                Cheque #{editingCheque.chequeNumber} — Activity History &amp; Audit Log
              </h3>
            </div>
            <span className="text-xs font-mono-num text-[#627D98]">
              {auditLogs.filter((l) => l.chequeId === editingCheque.id).length} Event(s)
            </span>
          </div>
          <div className="p-5">
            <ActivityTimeline
              entries={auditLogs.filter((l) => l.chequeId === editingCheque.id)}
              emptyMessage="No activity recorded for this cheque yet."
            />
          </div>
        </section>
      )}
    </div>
  );
}
