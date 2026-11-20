import React, { useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  CheckCircle2,
  FileSpreadsheet,
  RefreshCw,
  Wallet,
  X,
} from 'lucide-react';
import {
  BankCollectionStatus,
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
} from '../types/treasury';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';

export type RecoveryChoice =
  | 'NEFT_RTGS_UPI'
  | 'CASH'
  | 'REPLACEMENT_CHEQUE'
  | 'RE_PRESENT';

export type RecoveryActionSubmission =
  | {
      choice: 'NEFT_RTGS_UPI' | 'CASH';
      refNumber: string;
      paymentDate: string;
      receivedAmount: number;
      bounceChargesCollected: number;
      bankCollectionStatus?: BankCollectionStatus;
      remarks?: string;
    }
  | {
      choice: 'REPLACEMENT_CHEQUE';
      newChequeNumber: string;
      newChequeDate: string;
      bankName: string;
      branchName: string;
      amount: number;
      bounceChargesCollected: number;
      batchMode: 'existing' | 'new' | 'none';
      targetBatchId?: string;
      newBatchDepositDate?: string;
      newBatchBankAccountId?: string;
      remarks?: string;
    }
  | {
      choice: 'RE_PRESENT';
      batchMode: 'existing' | 'new';
      targetBatchId?: string;
      newBatchDepositDate?: string;
      newBatchBankAccountId?: string;
      remarks?: string;
    };

interface RecoveryActionModalProps {
  cheque: ChequeEntry;
  batches: ClearingBatch[];
  bankAccounts: CompanyBankAccount[];
  activeBatchId: string;
  onClose: () => void;
  onSubmit: (submission: RecoveryActionSubmission) => void;
}

export function RecoveryActionModal({
  cheque,
  batches,
  bankAccounts,
  activeBatchId,
  onClose,
  onSubmit,
}: RecoveryActionModalProps) {
  const today = new Date().toISOString().slice(0, 10);
  const alreadyPaid = Math.min(
    cheque.amount,
    Math.max(0, cheque.recoveredAmount ?? 0)
  );
  const remainingBalance = Math.max(0, cheque.amount - alreadyPaid);
  const alreadyCharges = Math.max(0, cheque.bounceChargesCollected ?? 0);

  const unlockedBatches = useMemo(
    () => batches.filter((b) => !b.isLocked),
    [batches]
  );
  const defaultUnlockedBatchId = useMemo(() => {
    const activeUnlocked = unlockedBatches.find((b) => b.id === activeBatchId);
    return activeUnlocked?.id || unlockedBatches[0]?.id || '';
  }, [unlockedBatches, activeBatchId]);

  const [choice, setChoice] = useState<RecoveryChoice>('NEFT_RTGS_UPI');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // NEFT / RTGS / UPI & Cash state
  const [refNumber, setRefNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(today);
  const [receivedAmount, setReceivedAmount] = useState(
    remainingBalance > 0 ? String(remainingBalance) : ''
  );
  const [bounceChargesCollected, setBounceChargesCollected] = useState(
    cheque.penaltyAmount && alreadyCharges === 0
      ? String(cheque.penaltyAmount)
      : ''
  );
  const [bankCollectionStatus, setBankCollectionStatus] =
    useState<BankCollectionStatus>(
      cheque.bankCollectionStatus || 'Collected from Bank'
    );
  const [remarks, setRemarks] = useState(cheque.remarks || '');

  // Replacement cheque state
  const [newChequeNumber, setNewChequeNumber] = useState('');
  const [newChequeDate, setNewChequeDate] = useState(today);
  const [newBankName, setNewBankName] = useState(cheque.draweeBank);
  const [newBranchName, setNewBranchName] = useState(cheque.draweeBranch);
  const [replacementAmount, setReplacementAmount] = useState(
    remainingBalance > 0 ? String(remainingBalance) : String(cheque.amount)
  );
  const [replacementBatchMode, setReplacementBatchMode] = useState<
    'existing' | 'new' | 'none'
  >(defaultUnlockedBatchId ? 'existing' : 'new');
  const [replacementTargetBatchId, setReplacementTargetBatchId] = useState(
    defaultUnlockedBatchId
  );

  // Re-Deposit same cheque state
  const [redepositBatchMode, setRedepositBatchMode] = useState<
    'existing' | 'new'
  >(defaultUnlockedBatchId ? 'existing' : 'new');
  const [redepositTargetBatchId, setRedepositTargetBatchId] = useState(
    defaultUnlockedBatchId
  );
  const [newBatchDate, setNewBatchDate] = useState(today);
  const [newBatchBankId, setNewBatchBankId] = useState(
    cheque.companyBankAccountId || bankAccounts[0]?.id || ''
  );

  const parsedReceived = useMemo(() => {
    const val = parseFloat(receivedAmount);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [receivedAmount]);

  const parsedReplacementAmount = useMemo(() => {
    const val = parseFloat(replacementAmount);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [replacementAmount]);

  const parsedCharges = useMemo(() => {
    const val = parseFloat(bounceChargesCollected);
    return Number.isFinite(val) && val > 0 ? val : 0;
  }, [bounceChargesCollected]);

  const previewNewPaidTotal =
    choice === 'REPLACEMENT_CHEQUE'
      ? Math.min(cheque.amount, alreadyPaid + parsedReplacementAmount)
      : Math.min(cheque.amount, alreadyPaid + parsedReceived);
  const previewRemaining = Math.max(0, cheque.amount - previewNewPaidTotal);

  const nextPresentationNo = (cheque.presentationCount || 1) + 1;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (choice === 'NEFT_RTGS_UPI' || choice === 'CASH') {
      if (!refNumber.trim()) {
        setErrorMsg(
          choice === 'CASH'
            ? 'Please enter the Cash Receipt Number.'
            : 'Please enter the NEFT / RTGS / UPI Transaction Reference Number.'
        );
        return;
      }
      if (!paymentDate) {
        setErrorMsg('Please select the Payment Date.');
        return;
      }
      if (parsedReceived <= 0) {
        setErrorMsg('Please enter a valid Received Amount greater than ₹0.');
        return;
      }
      onSubmit({
        choice,
        refNumber: refNumber.trim(),
        paymentDate,
        receivedAmount: parsedReceived,
        bounceChargesCollected: parsedCharges,
        bankCollectionStatus,
        remarks: remarks.trim() || undefined,
      });
      return;
    }

    if (choice === 'REPLACEMENT_CHEQUE') {
      const cleanNo = newChequeNumber.replace(/\D/g, '');
      if (cleanNo.length !== 6) {
        setErrorMsg('Replacement Cheque Number must be 6 digits.');
        return;
      }
      if (!newChequeDate) {
        setErrorMsg('Please select the Replacement Cheque Date.');
        return;
      }
      if (!newBankName.trim()) {
        setErrorMsg('Please enter the Replacement Cheque Bank Name.');
        return;
      }
      if (parsedReplacementAmount <= 0) {
        setErrorMsg('Please enter a valid Replacement Cheque Amount.');
        return;
      }
      if (replacementBatchMode === 'existing' && !replacementTargetBatchId) {
        setErrorMsg('Select an unlocked deposit batch or choose Create New Batch.');
        return;
      }
      onSubmit({
        choice: 'REPLACEMENT_CHEQUE',
        newChequeNumber: cleanNo,
        newChequeDate,
        bankName: newBankName.trim(),
        branchName: newBranchName.trim() || 'Local Clearing',
        amount: parsedReplacementAmount,
        bounceChargesCollected: parsedCharges,
        batchMode: replacementBatchMode,
        targetBatchId:
          replacementBatchMode === 'existing'
            ? replacementTargetBatchId
            : undefined,
        newBatchDepositDate:
          replacementBatchMode === 'new' ? newBatchDate : undefined,
        newBatchBankAccountId:
          replacementBatchMode === 'new' ? newBatchBankId : undefined,
        remarks: remarks.trim() || undefined,
      });
      return;
    }

    // RE_PRESENT
    if (redepositBatchMode === 'existing' && !redepositTargetBatchId) {
      setErrorMsg('Select an unlocked batch or choose Create New Deposit Batch.');
      return;
    }
    onSubmit({
      choice: 'RE_PRESENT',
      batchMode: redepositBatchMode,
      targetBatchId:
        redepositBatchMode === 'existing' ? redepositTargetBatchId : undefined,
      newBatchDepositDate:
        redepositBatchMode === 'new' ? newBatchDate : undefined,
      newBatchBankAccountId:
        redepositBatchMode === 'new' ? newBatchBankId : undefined,
      remarks: remarks.trim() || undefined,
    });
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-center justify-center bg-[#102A43]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="recovery-action-modal-title"
    >
      <div className="w-full max-w-2xl max-h-[92vh] bg-white border border-[#D9E2EC] rounded-lg shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] shrink-0">
          <div className="flex items-center gap-2.5">
            <Wallet className="w-4 h-4 text-[#176B87]" aria-hidden="true" />
            <div>
              <h3
                id="recovery-action-modal-title"
                className="text-base font-semibold text-[#102A43]"
              >
                Record Recovery / Re-Deposit Action
              </h3>
              <p className="text-xs text-[#627D98] font-mono-num">
                Cheque #{cheque.chequeNumber} · {cheque.partyName}
              </p>
            </div>
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

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-5">
          {/* Cheque & Partial Balance Snapshot */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md text-xs">
            <div>
              <div className="text-[#627D98]">Cheque Amount</div>
              <div className="font-mono-num font-bold text-[#102A43] mt-0.5">
                {formatINR(cheque.amount)}
              </div>
            </div>
            <div>
              <div className="text-[#627D98]">Paid / Recovered</div>
              <div className="font-mono-num font-bold text-[#16A34A] mt-0.5">
                {formatINR(alreadyPaid)}
              </div>
            </div>
            <div>
              <div className="text-[#627D98]">Remaining Balance</div>
              <div className="font-mono-num font-bold text-[#DC2626] mt-0.5">
                {formatINR(remainingBalance)}
              </div>
            </div>
            <div>
              <div className="text-[#627D98]">Charges Collected</div>
              <div className="font-mono-num font-semibold text-[#102A43] mt-0.5">
                {formatINR(alreadyCharges)}
              </div>
            </div>
            <div className="col-span-2 sm:col-span-4 pt-2 border-t border-[#D9E2EC] flex flex-wrap justify-between gap-2 text-[11px] text-[#627D98]">
              <span>
                Return Reason:{' '}
                <strong className="text-[#DC2626]">
                  {cheque.bounceReason || 'Not Specified'}
                </strong>
              </span>
              {cheque.penaltyAmount ? (
                <span className="font-mono-num">
                  Bank Penalty: <strong className="text-[#102A43]">{formatINR(cheque.penaltyAmount)}</strong>
                </span>
              ) : null}
            </div>
          </div>

          {/* Prior Installment History (if any partial payments exist) */}
          {cheque.recoveryPayments && cheque.recoveryPayments.length > 0 && (
            <div className="border border-[#D9E2EC] rounded-md overflow-hidden">
              <div className="px-3.5 py-2 bg-[#F4F7FA] border-b border-[#D9E2EC] text-[11px] font-semibold text-[#102A43]">
                Recorded Installments / Recovery Parts ({cheque.recoveryPayments.length})
              </div>
              <table className="w-full text-left text-[11px] border-collapse">
                <thead>
                  <tr className="border-b border-[#D9E2EC] text-[#627D98]">
                    <th className="py-1.5 px-3">Date</th>
                    <th className="py-1.5 px-3">Mode</th>
                    <th className="py-1.5 px-3">Ref / Receipt</th>
                    <th className="py-1.5 px-3 text-right">Paid (₹)</th>
                    <th className="py-1.5 px-3 text-right">Charges (₹)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#D9E2EC] font-mono-num">
                  {cheque.recoveryPayments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-1.5 px-3 text-[#243B53]">
                        {formatIndianDate(p.paymentDate)}
                      </td>
                      <td className="py-1.5 px-3 font-sans text-[#243B53]">{p.mode}</td>
                      <td className="py-1.5 px-3 text-[#243B53]">{p.refNumber}</td>
                      <td className="py-1.5 px-3 text-right font-semibold text-[#16A34A]">
                        {formatINR(p.amount)}
                      </td>
                      <td className="py-1.5 px-3 text-right text-[#627D98]">
                        {p.bounceChargesCollected
                          ? formatINR(p.bounceChargesCollected)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 4 Settlement / Action Choices */}
          <div>
            <label className="block text-xs font-semibold text-[#102A43] mb-2">
              Choose Recovery / Action Method
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setChoice('NEFT_RTGS_UPI');
                  setErrorMsg(null);
                }}
                className={`p-3 text-left rounded-md border transition-colors flex items-start gap-2.5 ${
                  choice === 'NEFT_RTGS_UPI'
                    ? 'border-[#102A43] bg-[#102A43] text-white'
                    : 'border-[#D9E2EC] bg-white text-[#243B53] hover:bg-[#F4F7FA]'
                }`}
              >
                <Building2 className={`w-4 h-4 shrink-0 mt-0.5 ${choice === 'NEFT_RTGS_UPI' ? 'text-[#14B8A6]' : 'text-[#176B87]'}`} aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold">
                    Settled via NEFT / RTGS / UPI
                  </div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      choice === 'NEFT_RTGS_UPI' ? 'text-white/75' : 'text-[#627D98]'
                    }`}
                  >
                    UTR / Txn Ref, Payment Date &amp; Amount
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setChoice('CASH');
                  setErrorMsg(null);
                }}
                className={`p-3 text-left rounded-md border transition-colors flex items-start gap-2.5 ${
                  choice === 'CASH'
                    ? 'border-[#102A43] bg-[#102A43] text-white'
                    : 'border-[#D9E2EC] bg-white text-[#243B53] hover:bg-[#F4F7FA]'
                }`}
              >
                <Banknote className={`w-4 h-4 shrink-0 mt-0.5 ${choice === 'CASH' ? 'text-[#14B8A6]' : 'text-[#176B87]'}`} aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold">Settled via Cash</div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      choice === 'CASH' ? 'text-white/75' : 'text-[#627D98]'
                    }`}
                  >
                    Receipt No., Payment Date &amp; Amount
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setChoice('REPLACEMENT_CHEQUE');
                  setErrorMsg(null);
                }}
                className={`p-3 text-left rounded-md border transition-colors flex items-start gap-2.5 ${
                  choice === 'REPLACEMENT_CHEQUE'
                    ? 'border-[#102A43] bg-[#102A43] text-white'
                    : 'border-[#D9E2EC] bg-white text-[#243B53] hover:bg-[#F4F7FA]'
                }`}
              >
                <FileSpreadsheet
                  className={`w-4 h-4 shrink-0 mt-0.5 ${choice === 'REPLACEMENT_CHEQUE' ? 'text-[#14B8A6]' : 'text-[#176B87]'}`}
                  aria-hidden="true"
                />
                <div>
                  <div className="text-xs font-semibold">
                    Replaced with New Cheque
                  </div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      choice === 'REPLACEMENT_CHEQUE'
                        ? 'text-white/75'
                        : 'text-[#627D98]'
                    }`}
                  >
                    New Chq No., Date, Bank &amp; Batch Link
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setChoice('RE_PRESENT');
                  setErrorMsg(null);
                }}
                className={`p-3 text-left rounded-md border transition-colors flex items-start gap-2.5 ${
                  choice === 'RE_PRESENT'
                    ? 'border-[#102A43] bg-[#102A43] text-white'
                    : 'border-[#D9E2EC] bg-white text-[#243B53] hover:bg-[#F4F7FA]'
                }`}
              >
                <RefreshCw className={`w-4 h-4 shrink-0 mt-0.5 ${choice === 'RE_PRESENT' ? 'text-[#14B8A6]' : 'text-[#176B87]'}`} aria-hidden="true" />
                <div>
                  <div className="text-xs font-semibold">
                    Re-Present Same Cheque
                  </div>
                  <div
                    className={`text-[11px] mt-0.5 ${
                      choice === 'RE_PRESENT' ? 'text-white/75' : 'text-[#627D98]'
                    }`}
                  >
                    1-Click Move to Re-Deposit ({nextPresentationNo}
                    {nextPresentationNo === 2 ? 'nd' : nextPresentationNo === 3 ? 'rd' : 'th'}{' '}
                    Presentation)
                  </div>
                </div>
              </button>
            </div>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-md text-xs text-[#DC2626]"
            >
              {errorMsg}
            </div>
          )}

          {/* CHOICE 1 & 2: NEFT/RTGS/UPI or CASH */}
          {(choice === 'NEFT_RTGS_UPI' || choice === 'CASH') && (
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    {choice === 'CASH'
                      ? 'Receipt Number'
                      : 'Transaction Reference Number (UTR / UPI)'}{' '}
                    <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    value={refNumber}
                    onChange={(e) => setRefNumber(e.target.value)}
                    placeholder={
                      choice === 'CASH'
                        ? 'e.g. RCPT/2026-27/0148'
                        : 'e.g. HDFCR520261118004912'
                    }
                    className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Payment Date <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="date"
                    value={paymentDate}
                    onChange={(e) => setPaymentDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-[#243B53]">
                      Received Amount (₹) <span className="text-[#DC2626]">*</span>
                    </label>
                    {remainingBalance > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setReceivedAmount(String(remainingBalance))
                        }
                        className="text-[11px] font-medium text-[#176B87] hover:text-[#102A43] underline"
                      >
                        Full Balance ({formatINR(remainingBalance)})
                      </button>
                    )}
                  </div>
                  <input
                    type="number"
                    min="0.01"
                    max={Math.max(cheque.amount, remainingBalance || cheque.amount)}
                    step="0.01"
                    value={receivedAmount}
                    onChange={(e) => setReceivedAmount(e.target.value)}
                    placeholder="Enter full or partial payment"
                    className="w-full px-3 py-2 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Bounce Charges Collected (₹){' '}
                    <span className="text-[#627D98] font-normal">(Optional)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bounceChargesCollected}
                    onChange={(e) => setBounceChargesCollected(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Physical Cheque Status
                  </label>
                  <select
                    value={bankCollectionStatus}
                    onChange={(e) =>
                      setBankCollectionStatus(
                        e.target.value as BankCollectionStatus
                      )
                    }
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  >
                    <option value="Collected from Bank">
                      Collected from Bank
                    </option>
                    <option value="Pending Collection">
                      Pending Collection
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Remarks / Notes
                  </label>
                  <input
                    type="text"
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    placeholder="e.g. Part 1 of 2 received"
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>

              {/* Partial Payment Preview Bar */}
              <div className="p-3 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md text-xs flex flex-wrap items-center justify-between gap-2">
                <span className="text-[#102A43]">
                  After saving:{' '}
                  <strong className="font-mono-num">
                    Paid {formatINR(previewNewPaidTotal)}
                  </strong>{' '}
                  ·{' '}
                  <strong className="font-mono-num">
                    Remaining {formatINR(previewRemaining)}
                  </strong>
                  {parsedCharges > 0 && (
                    <span>
                      {' '}
                      · + {formatINR(parsedCharges)} Bounce Charges
                    </span>
                  )}
                </span>
                <span className="font-semibold text-[#16A34A]">
                  {previewRemaining === 0
                    ? 'Full Settlement → Settled / Recovered'
                    : 'Partial Payment Recorded → Settled / Recovered (Partial)'}
                </span>
              </div>
            </div>
          )}

          {/* CHOICE 3: REPLACED WITH NEW CHEQUE */}
          {choice === 'REPLACEMENT_CHEQUE' && (
            <div className="space-y-4 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    New Cheque Number (6 digits){' '}
                    <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={6}
                    value={newChequeNumber}
                    onChange={(e) =>
                      setNewChequeNumber(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="e.g. 512890"
                    className="w-full px-3 py-2 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    New Cheque Date <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="date"
                    value={newChequeDate}
                    onChange={(e) => setNewChequeDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Bank Name <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    value={newBankName}
                    onChange={(e) => setNewBankName(e.target.value)}
                    placeholder="e.g. HDFC Bank Ltd."
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="e.g. Lower Parel, Mumbai"
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Replacement Cheque Amount (₹){' '}
                    <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={replacementAmount}
                    onChange={(e) => setReplacementAmount(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Bounce Charges Collected (₹){' '}
                    <span className="text-[#627D98] font-normal">(Optional)</span>
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={bounceChargesCollected}
                    onChange={(e) => setBounceChargesCollected(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>

              {/* Optional Link to Deposit Batch */}
              <div className="p-3.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md space-y-3">
                <label className="block text-xs font-semibold text-[#102A43]">
                  Link Replacement Cheque to Deposit Batch
                </label>
                <div className="flex flex-wrap gap-3 text-xs text-[#243B53]">
                  {unlockedBatches.length > 0 && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="repBatchMode"
                        checked={replacementBatchMode === 'existing'}
                        onChange={() => setReplacementBatchMode('existing')}
                      />
                      <span>Existing Unlocked Batch</span>
                    </label>
                  )}
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="repBatchMode"
                      checked={replacementBatchMode === 'new'}
                      onChange={() => setReplacementBatchMode('new')}
                    />
                    <span>Create New Deposit Batch</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="repBatchMode"
                      checked={replacementBatchMode === 'none'}
                      onChange={() => setReplacementBatchMode('none')}
                    />
                    <span>Record Reference Only</span>
                  </label>
                </div>

                {replacementBatchMode === 'existing' &&
                  unlockedBatches.length > 0 && (
                    <select
                      value={replacementTargetBatchId}
                      onChange={(e) =>
                        setReplacementTargetBatchId(e.target.value)
                      }
                      className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    >
                      {unlockedBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batchRef} ({formatIndianDate(b.depositDate)})
                        </option>
                      ))}
                    </select>
                  )}

                {replacementBatchMode === 'new' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#627D98] mb-1">
                        New Batch Deposit Date
                      </label>
                      <input
                        type="date"
                        value={newBatchDate}
                        onChange={(e) => setNewBatchDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#627D98] mb-1">
                        Deposit Bank Account
                      </label>
                      <select
                        value={newBatchBankId}
                        onChange={(e) => setNewBatchBankId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43]"
                      >
                        {bankAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.bankName} ({acc.accountNumber})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* CHOICE 4: RE-PRESENT SAME CHEQUE */}
          {choice === 'RE_PRESENT' && (
            <div className="space-y-4 pt-1">
              <div className="p-3.5 bg-[#176B87]/10 border border-[#176B87]/30 rounded-md text-xs text-[#102A43] space-y-1">
                <div className="font-semibold">
                  Move Cheque #{cheque.chequeNumber} to Re-Deposit (
                  {nextPresentationNo}
                  {nextPresentationNo === 2
                    ? 'nd'
                    : nextPresentationNo === 3
                    ? 'rd'
                    : 'th'}
                  -Time Presentation)
                </div>
                <p className="text-[11px] text-[#243B53]">
                  Clones this instrument into the selected deposit batch marked as{' '}
                  <strong>{nextPresentationNo}nd Presentation</strong> and
                  updates this returned record&apos;s status to{' '}
                  <strong>Re-Deposited</strong>.
                </p>
              </div>

              <div className="p-3.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md space-y-3">
                <label className="block text-xs font-semibold text-[#102A43]">
                  Target Deposit Batch for Re-Presentation
                </label>
                <div className="flex flex-wrap gap-4 text-xs text-[#243B53]">
                  {unlockedBatches.length > 0 && (
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="radio"
                        name="redepositBatchMode"
                        checked={redepositBatchMode === 'existing'}
                        onChange={() => setRedepositBatchMode('existing')}
                      />
                      <span>Move to Existing Unlocked Batch</span>
                    </label>
                  )}
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="redepositBatchMode"
                      checked={redepositBatchMode === 'new'}
                      onChange={() => setRedepositBatchMode('new')}
                    />
                    <span>Create New Deposit Batch</span>
                  </label>
                </div>

                {redepositBatchMode === 'existing' &&
                  unlockedBatches.length > 0 && (
                    <select
                      value={redepositTargetBatchId}
                      onChange={(e) =>
                        setRedepositTargetBatchId(e.target.value)
                      }
                      className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43]"
                    >
                      {unlockedBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.batchRef} ({formatIndianDate(b.depositDate)})
                          {b.id === activeBatchId ? ' — Active Batch' : ''}
                        </option>
                      ))}
                    </select>
                  )}

                {redepositBatchMode === 'new' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-[#627D98] mb-1">
                        New Batch Deposit Date
                      </label>
                      <input
                        type="date"
                        value={newBatchDate}
                        onChange={(e) => setNewBatchDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[#627D98] mb-1">
                        Deposit Bank Account
                      </label>
                      <select
                        value={newBatchBankId}
                        onChange={(e) => setNewBatchBankId(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43]"
                      >
                        {bankAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.bankName} ({acc.accountNumber})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Re-Presentation Remarks (Optional)
                </label>
                <input
                  type="text"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="e.g. Customer confirmed funds available for 2nd presentation"
                  className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98]"
                />
              </div>
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#D9E2EC]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
            >
              Cancel
            </button>

            {choice === 'RE_PRESENT' ? (
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#176B87] rounded-md hover:bg-[#102A43] transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Move to Re-Deposit</span>
              </button>
            ) : (
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {choice === 'REPLACEMENT_CHEQUE'
                    ? 'Save Replacement & Mark Settled'
                    : 'Save Recovery Details'}
                </span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
