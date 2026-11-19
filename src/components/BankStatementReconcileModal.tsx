import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Landmark,
  Lock,
  Plus,
  Upload,
  X,
} from 'lucide-react';
import { BOUNCE_REASONS } from '../data/indianBanks';
import {
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CustomerProfile,
  DayBookEntry,
  DayBookVoucherType,
} from '../types/treasury';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';
import {
  downloadSampleBankStatementCSV,
  parseAndReconcileBankStatement,
  StatementParseResult,
} from '../utils/statementParser';

export interface ReconcileConfirmItem {
  chequeId: string;
  matchType: 'CLEARED' | 'RETURNED';
  targetStatus: 'Cleared' | 'Returned / Bounced';
  returnReason: string;
  bouncedDate: string;
  clearedDate?: string;
  statementDate?: string;
  statementNarration?: string;
  statementAmount?: number;
  isCredit?: boolean;
  associatedChargeAmount?: number;
  associatedChargeDate?: string;
  associatedChargeNarration?: string;
  hasPassedAndReturnedPair?: boolean;
  passedRowDate?: string;
  passedRowNarration?: string;
}

export interface OtherTxConfirmItem {
  id: string;
  txDate: string;
  voucherType: DayBookVoucherType;
  partyOrLedger: string;
  narration: string;
  refNo: string;
  amount: number;
  direction: 'CR' | 'DR';
  statementRunningBalance?: number;
}

export interface ReconcileConfirmPayload {
  bankAccountId: string;
  fileName: string;
  chequeUpdates: ReconcileConfirmItem[];
  otherTransactions: OtherTxConfirmItem[];
  statementOpeningBalance?: number;
  statementClosingBalance?: number;
  statementClosingDate?: string;
  applyOpeningBalance?: boolean;
}

type VoucherChoice = DayBookVoucherType | 'Ignore';
type ReconcileTab = 'cleared' | 'returned' | 'other';

interface OtherTxEditState {
  included: boolean;
  voucherType: VoucherChoice;
  partyOrLedger: string;
  narration: string;
  txDate: string;
}

interface BankStatementReconcileModalProps {
  cheques: ChequeEntry[];
  batches: ClearingBatch[];
  bankAccounts: CompanyBankAccount[];
  customers?: CustomerProfile[];
  existingDayBookEntries?: DayBookEntry[];
  defaultBankAccountId?: string;
  onQuickAddBankAccount?: (account: Omit<CompanyBankAccount, 'id'>) => string;
  onConfirmReconcile: (payload: ReconcileConfirmPayload) => void;
  onClose: () => void;
}

const CUSTOM_OPTION = '__CUSTOM__';

const STANDARD_LEDGER_HEADS = [
  'Bank Charges',
  'Bank Interest',
  'Bank Interest & Finance Charges',
  'Cash Deposit / Withdrawal',
  'Customer / Sundry Receipt',
  'Vendor / Expense Payment',
  'Salary & Wages',
  'Office Rent & Utilities',
  'GST / Statutory Tax Payment',
  'Loan / EMI Payment',
  'Directors / Capital A/c',
  'Suspense A/c',
];

export function BankStatementReconcileModal({
  cheques,
  batches,
  bankAccounts,
  customers = [],
  existingDayBookEntries = [],
  defaultBankAccountId,
  onQuickAddBankAccount,
  onConfirmReconcile,
  onClose,
}: BankStatementReconcileModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<StatementParseResult | null>(null);
  const [activeTab, setActiveTab] = useState<ReconcileTab>('cleared');

  // Bank Account selection & Quick-Add Bank state
  const initialBankId =
    defaultBankAccountId ||
    bankAccounts.find((b) => b.isDefault)?.id ||
    bankAccounts[0]?.id ||
    '';
  const [selectedBankAccountId, setSelectedBankAccountId] =
    useState<string>(initialBankId);
  const [showQuickAddBank, setShowQuickAddBank] = useState(
    bankAccounts.length === 0
  );
  const [quickBankName, setQuickBankName] = useState('');
  const [quickAccountType, setQuickAccountType] =
    useState<CompanyBankAccount['accountType']>('Current A/c');
  const [quickAccountNumber, setQuickAccountNumber] = useState('');
  const [quickIfsc, setQuickIfsc] = useState('');
  const [quickBranchName, setQuickBranchName] = useState('');
  const [quickOpeningBalance, setQuickOpeningBalance] = useState('0');
  const [syncOpeningBalance, setSyncOpeningBalance] = useState(false);

  // Editable per-match selection, reason, and return date (Returned cheques)
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({});
  const [dateMap, setDateMap] = useState<Record<string, string>>({});

  // Editable per-match selection and clearing date (Cleared cheques)
  const [clearedSelectedMap, setClearedSelectedMap] = useState<
    Record<string, boolean>
  >({});
  const [clearedDateMap, setClearedDateMap] = useState<Record<string, string>>(
    {}
  );

  // Editable per-row state for Other Bank Transactions -> Day Book
  const [otherEditMap, setOtherEditMap] = useState<
    Record<string, OtherTxEditState>
  >({});
  const [otherDirectionFilter, setOtherDirectionFilter] = useState<
    'ALL' | 'CR' | 'DR'
  >('ALL');

  const selectedBank = useMemo(
    () => bankAccounts.find((b) => b.id === selectedBankAccountId) || null,
    [bankAccounts, selectedBankAccountId]
  );

  const autocompleteLedgerOptions = useMemo(() => {
    const set = new Set<string>(STANDARD_LEDGER_HEADS);
    customers.forEach((c) => {
      if (c.partyName?.trim()) set.add(c.partyName.trim());
    });
    cheques.forEach((c) => {
      if (c.partyName?.trim()) set.add(c.partyName.trim());
    });
    existingDayBookEntries.forEach((e) => {
      if (e.partyName?.trim()) set.add(e.partyName.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customers, cheques, existingDayBookEntries]);

  const handleQuickAddBankSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onQuickAddBankAccount) return;
    if (!quickBankName.trim() || !quickAccountNumber.trim()) return;
    const parsedOpening = parseFloat(quickOpeningBalance.replace(/,/g, '')) || 0;
    const newId = onQuickAddBankAccount({
      bankName: quickBankName.trim(),
      accountType: quickAccountType,
      accountNumber: quickAccountNumber.trim(),
      ifscCode: quickIfsc.trim().toUpperCase() || 'NA',
      branchName: quickBranchName.trim() || 'Main Branch',
      branchAddress: quickBranchName.trim() || 'Corporate Branch',
      isDefault: bankAccounts.length === 0,
      openingBalance: parsedOpening,
    });
    setSelectedBankAccountId(newId);
    setQuickBankName('');
    setQuickAccountNumber('');
    setQuickIfsc('');
    setQuickBranchName('');
    setQuickOpeningBalance('0');
    setShowQuickAddBank(false);
  };

  const processFile = async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    try {
      const parsed = await parseAndReconcileBankStatement(file, cheques, batches);
      setResult(parsed);

      const nextSelected: Record<string, boolean> = {};
      const nextReasons: Record<string, string> = {};
      const nextDates: Record<string, string> = {};
      for (const item of parsed.returnedMatches) {
        nextSelected[item.id] = true;
        nextReasons[item.id] = item.detectedReason;
        nextDates[item.id] = item.statementDate;
      }
      setSelectedMap(nextSelected);
      setReasonMap(nextReasons);
      setDateMap(nextDates);

      const nextClearedSelected: Record<string, boolean> = {};
      const nextClearedDates: Record<string, string> = {};
      for (const item of parsed.clearedMatches) {
        nextClearedSelected[item.id] = !item.alreadyCleared;
        nextClearedDates[item.id] = item.statementDate;
      }
      setClearedSelectedMap(nextClearedSelected);
      setClearedDateMap(nextClearedDates);

      const nextOtherEdits: Record<string, OtherTxEditState> = {};
      for (const tx of parsed.otherTransactions) {
        nextOtherEdits[tx.id] = {
          included: true,
          voucherType: tx.suggestedVoucherType,
          partyOrLedger: tx.suggestedPartyName || tx.suggestedLedgerCategory,
          narration: tx.narration,
          txDate: tx.txDate,
        };
      }
      setOtherEditMap(nextOtherEdits);

      // Default tab to the first section with actionable rows
      if (parsed.clearedMatches.length > 0) {
        setActiveTab('cleared');
      } else if (parsed.returnedMatches.length > 0) {
        setActiveTab('returned');
      } else {
        setActiveTab('other');
      }

      // Auto-suggest syncing opening balance if account currently has 0 opening balance & no Day Book entries yet
      const accExistingEntries = existingDayBookEntries.filter(
        (e) => e.companyBankAccountId === selectedBankAccountId
      );
      const currentOpening = selectedBank?.openingBalance ?? 0;
      if (
        parsed.statementOpeningBalance !== undefined &&
        currentOpening === 0 &&
        accExistingEntries.length === 0
      ) {
        setSyncOpeningBalance(true);
      } else {
        setSyncOpeningBalance(false);
      }
    } catch (err) {
      setParseError(
        err instanceof Error
          ? `Unable to parse statement file: ${err.message}`
          : 'Unable to read the uploaded bank statement file. Please verify the format.'
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const handleAssignAmbiguousCheque = (rowIndex: number, chequeId: string) => {
    if (!result || !chequeId) return;
    const targetRow = result.unmatchedReturnRows.find(
      (u) => u.rowIndex === rowIndex
    );
    const chosenCheque = cheques.find((c) => c.id === chequeId);
    if (!targetRow || !chosenCheque) return;
    const batch = batches.find((b) => b.id === chosenCheque.batchId);
    const newId = `rec-manual-${targetRow.rowIndex}-${chosenCheque.id}`;

    if (result.returnedMatches.some((m) => m.cheque.id === chosenCheque.id)) {
      return;
    }

    const hadCleared = result.clearedMatches.some(
      (c) => c.cheque.id === chosenCheque.id
    );

    const newCandidate = {
      id: newId,
      matchType: 'RETURNED' as const,
      matchMethod: 'MANUAL' as const,
      cheque: chosenCheque,
      batchName: batch?.batchRef || 'Unknown Batch',
      isBatchLocked: Boolean(batch?.isLocked),
      statementDate: targetRow.txnDate || new Date().toISOString().slice(0, 10),
      statementNarration: targetRow.narration,
      statementAmount: targetRow.amount,
      isCredit: targetRow.isCredit,
      txnDirection: targetRow.isCredit
        ? ('CR' as const)
        : targetRow.debitAmount > 0
        ? ('DR' as const)
        : undefined,
      amountMatches:
        targetRow.amount > 0
          ? Math.abs(chosenCheque.amount - targetRow.amount) < 1.0
          : true,
      detectedReason:
        targetRow.detectedReason || 'Cheque Returned (Manual Review)',
      alreadyReturned: chosenCheque.status === 'Returned / Bounced',
      matchedStatementNumber: targetRow.chequeNumber || 'Manual Assignment',
      hasPassedAndReturnedPair: hadCleared,
    };

    setResult({
      ...result,
      returnedMatches: [...result.returnedMatches, newCandidate],
      clearedMatches: result.clearedMatches.filter(
        (c) => c.cheque.id !== chosenCheque.id
      ),
      unmatchedReturnRows: result.unmatchedReturnRows.filter(
        (u) => u.rowIndex !== rowIndex
      ),
      otherTransactions: result.otherTransactions.filter(
        (tx) => tx.rowIndex !== rowIndex
      ),
    });
    setSelectedMap((prev) => ({ ...prev, [newId]: true }));
    setReasonMap((prev) => ({ ...prev, [newId]: newCandidate.detectedReason }));
    setDateMap((prev) => ({ ...prev, [newId]: newCandidate.statementDate }));
  };

  const selectedReturnedCandidates = result
    ? result.returnedMatches.filter((item) => selectedMap[item.id])
    : [];

  const selectedClearedCandidates = result
    ? result.clearedMatches.filter((item) => clearedSelectedMap[item.id])
    : [];

  const selectedOtherTransactions = useMemo(() => {
    if (!result) return [];
    return result.otherTransactions.filter((tx) => {
      const edit = otherEditMap[tx.id];
      return edit ? edit.included && edit.voucherType !== 'Ignore' : true;
    });
  }, [result, otherEditMap]);

  const filteredOtherTransactions = useMemo(() => {
    if (!result) return [];
    if (otherDirectionFilter === 'ALL') return result.otherTransactions;
    return result.otherTransactions.filter(
      (tx) => tx.direction === otherDirectionFilter
    );
  }, [result, otherDirectionFilter]);

  const totalActionableCount =
    selectedClearedCandidates.length +
    selectedReturnedCandidates.length +
    selectedOtherTransactions.length;

  // Live projected Book Closing Balance for selected Bank Account
  const projectedBalanceSummary = useMemo(() => {
    if (!result || !selectedBank) return null;
    const baseOpening =
      syncOpeningBalance && result.statementOpeningBalance !== undefined
        ? result.statementOpeningBalance
        : selectedBank.openingBalance ?? 0;

    const existingForBank = existingDayBookEntries.filter(
      (e) => e.companyBankAccountId === selectedBank.id
    );
    const existingNet = existingForBank.reduce(
      (sum, e) => sum + (e.direction === 'CR' ? e.amount : -e.amount),
      0
    );

    // Estimate net impact of newly selected items from this statement
    let incomingNet = 0;
    const returnedChequeIdSet = new Set(
      selectedReturnedCandidates.map((r) => r.cheque.id)
    );
    for (const clr of selectedClearedCandidates) {
      if (returnedChequeIdSet.has(clr.cheque.id)) continue;
      const amt = clr.statementAmount || clr.cheque.amount;
      incomingNet += clr.isCredit !== false ? amt : -amt;
    }
    for (const ret of selectedReturnedCandidates) {
      const amt = ret.statementAmount || ret.cheque.amount;
      if (ret.hasPassedAndReturnedPair) {
        // +amt (cleared) - amt (return reversal) = 0 net, minus any bank charge
      } else {
        incomingNet += ret.isCredit ? amt : -amt;
      }
      if (ret.associatedChargeAmount && ret.associatedChargeAmount > 0) {
        incomingNet -= ret.associatedChargeAmount;
      }
    }
    for (const tx of selectedOtherTransactions) {
      incomingNet += tx.direction === 'CR' ? tx.amount : -tx.amount;
    }

    const projectedBookClosing = Number(
      (baseOpening + existingNet + incomingNet).toFixed(2)
    );
    const stmtClosing = result.statementClosingBalance;
    const diff =
      stmtClosing !== undefined
        ? Number((projectedBookClosing - stmtClosing).toFixed(2))
        : undefined;

    return {
      baseOpening,
      projectedBookClosing,
      stmtClosing,
      diff,
    };
  }, [
    result,
    selectedBank,
    syncOpeningBalance,
    existingDayBookEntries,
    selectedClearedCandidates,
    selectedReturnedCandidates,
    selectedOtherTransactions,
  ]);

  const handleConfirm = () => {
    if (!result || !selectedBankAccountId) return;
    if (totalActionableCount === 0 && result.statementClosingBalance === undefined) {
      return;
    }
    const today = new Date().toISOString().slice(0, 10);

    const returnedPayload: ReconcileConfirmItem[] = selectedReturnedCandidates.map(
      (item) => ({
        chequeId: item.cheque.id,
        matchType: 'RETURNED',
        targetStatus: 'Returned / Bounced',
        returnReason:
          (reasonMap[item.id] || '').trim() ||
          'Cheque Returned (Bank Statement)',
        bouncedDate: dateMap[item.id] || today,
        statementDate: dateMap[item.id] || item.statementDate || today,
        statementNarration: item.statementNarration,
        statementAmount: item.statementAmount || item.cheque.amount,
        isCredit: item.isCredit,
        associatedChargeAmount: item.associatedChargeAmount,
        associatedChargeDate: item.associatedChargeDate || dateMap[item.id] || today,
        associatedChargeNarration: item.associatedChargeNarration,
        hasPassedAndReturnedPair: item.hasPassedAndReturnedPair,
        passedRowDate: item.passedRowDate,
        passedRowNarration: item.passedRowNarration,
      })
    );

    const returnedChequeIdSet = new Set(returnedPayload.map((r) => r.chequeId));
    const clearedPayload: ReconcileConfirmItem[] = selectedClearedCandidates
      .filter((item) => !returnedChequeIdSet.has(item.cheque.id))
      .map((item) => ({
        chequeId: item.cheque.id,
        matchType: 'CLEARED',
        targetStatus: 'Cleared',
        returnReason: '',
        bouncedDate: '',
        clearedDate: clearedDateMap[item.id] || today,
        statementDate: clearedDateMap[item.id] || item.statementDate || today,
        statementNarration: item.statementNarration,
        statementAmount: item.statementAmount || item.cheque.amount,
        isCredit: item.isCredit,
      }));

    const otherPayload: OtherTxConfirmItem[] = selectedOtherTransactions.map(
      (tx) => {
        const edit = otherEditMap[tx.id];
        const chosenType: DayBookVoucherType =
          edit && edit.voucherType !== 'Ignore'
            ? edit.voucherType
            : tx.suggestedVoucherType;
        return {
          id: tx.id,
          txDate: edit?.txDate || tx.txDate || today,
          voucherType: chosenType,
          partyOrLedger:
            (edit?.partyOrLedger || '').trim() || tx.suggestedLedgerCategory,
          narration: (edit?.narration || '').trim() || tx.narration,
          refNo: tx.refNo,
          amount: tx.amount,
          direction: tx.direction,
          statementRunningBalance: tx.statementRunningBalance,
        };
      }
    );

    onConfirmReconcile({
      bankAccountId: selectedBankAccountId,
      fileName: result.fileName,
      chequeUpdates: [...clearedPayload, ...returnedPayload],
      otherTransactions: otherPayload,
      statementOpeningBalance: result.statementOpeningBalance,
      statementClosingBalance: result.statementClosingBalance,
      statementClosingDate: result.statementClosingDate,
      applyOpeningBalance: syncOpeningBalance,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconcile-modal-title"
    >
      <div className="w-full max-w-6xl max-h-[92vh] flex flex-col bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet
              className="w-5 h-5 text-slate-900"
              aria-hidden="true"
            />
            <div>
              <h3
                id="reconcile-modal-title"
                className="text-base font-semibold text-slate-900"
              >
                Bank Statement Auto-Reconciliation &amp; Day Book Posting
              </h3>
              <p className="text-xs text-slate-500">
                Match Cleared &amp; Returned Cheques, categorize remaining bank statement transactions, and verify Bank Closing Balance
              </p>
            </div>
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

        {/* Body */}
        <div className="overflow-y-auto p-6 space-y-5 flex-1">
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            onChange={handleFileChange}
            className="hidden"
          />

          <datalist id="daybook-party-ledger-options">
            {autocompleteLedgerOptions.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>

          {/* Bank Account Selector Bar */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <Landmark
                  className="w-4 h-4 text-slate-800 shrink-0"
                  aria-hidden="true"
                />
                <div>
                  <div className="font-semibold text-slate-900">
                    Target Bank Account for Statement &amp; Day Book Posting
                  </div>
                  <div className="text-[11px] text-slate-500">
                    All reconciled cheques and categorized transactions post directly into this Bank Account ledger
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Select Bank Account for Reconciliation"
                  value={selectedBankAccountId}
                  onChange={(e) => setSelectedBankAccountId(e.target.value)}
                  className="min-w-[260px] px-3 py-1.5 text-xs font-medium text-slate-900 bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                >
                  {bankAccounts.length === 0 && (
                    <option value="">No bank accounts configured — add one</option>
                  )}
                  {bankAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.bankName} — {acc.accountType} ({acc.accountNumber})
                    </option>
                  ))}
                </select>
                {onQuickAddBankAccount && (
                  <button
                    type="button"
                    onClick={() => setShowQuickAddBank((v) => !v)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Quick Add Bank</span>
                  </button>
                )}
              </div>
            </div>

            {selectedBank && (
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/80 text-[11px] text-slate-600">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>
                    Opening Balance:{' '}
                    <strong className="font-mono-num text-slate-900">
                      {formatINR(selectedBank.openingBalance ?? 0)}
                    </strong>
                  </span>
                  {selectedBank.statementClosingBalance !== undefined && (
                    <span>
                      Last Statement Closing:{' '}
                      <strong className="font-mono-num text-slate-900">
                        {formatINR(selectedBank.statementClosingBalance)}
                      </strong>
                      {selectedBank.statementClosingDate
                        ? ` (${formatIndianDate(selectedBank.statementClosingDate)})`
                        : ''}
                    </span>
                  )}
                </div>

                {result?.statementOpeningBalance !== undefined && (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={syncOpeningBalance}
                      onChange={(e) => setSyncOpeningBalance(e.target.checked)}
                      className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                    />
                    <span>
                      Apply detected Statement Opening Balance (
                      <span className="font-mono-num font-semibold">
                        {formatINR(result.statementOpeningBalance)}
                      </span>
                      ) to this bank account
                    </span>
                  </label>
                )}
              </div>
            )}

            {/* Quick-Add Bank Account Inline Form */}
            {showQuickAddBank && onQuickAddBankAccount && (
              <form
                onSubmit={handleQuickAddBankSubmit}
                className="pt-3 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-2.5 items-end"
              >
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Bank Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={quickBankName}
                    onChange={(e) => setQuickBankName(e.target.value)}
                    placeholder="e.g. HDFC Bank Ltd."
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Account Type
                  </label>
                  <select
                    value={quickAccountType}
                    onChange={(e) =>
                      setQuickAccountType(
                        e.target.value as CompanyBankAccount['accountType']
                      )
                    }
                    className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                  >
                    <option value="Current A/c">Current A/c</option>
                    <option value="Cash Credit A/c">Cash Credit A/c</option>
                    <option value="Collection A/c">Collection A/c</option>
                    <option value="Overdraft A/c">Overdraft A/c</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Account Number *
                  </label>
                  <input
                    type="text"
                    required
                    value={quickAccountNumber}
                    onChange={(e) => setQuickAccountNumber(e.target.value)}
                    placeholder="50200018273645"
                    className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    IFSC Code
                  </label>
                  <input
                    type="text"
                    maxLength={11}
                    value={quickIfsc}
                    onChange={(e) => setQuickIfsc(e.target.value.toUpperCase())}
                    placeholder="HDFC0000240"
                    className="w-full px-2.5 py-1.5 text-xs font-mono-num uppercase border border-slate-300 rounded bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-700 mb-1">
                    Opening Balance (₹)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={quickOpeningBalance}
                    onChange={(e) => setQuickOpeningBalance(e.target.value)}
                    placeholder="500000"
                    className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="submit"
                    className="flex-1 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded hover:bg-slate-800 whitespace-nowrap"
                  >
                    Save Bank
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuickAddBank(false)}
                    className="px-2.5 py-1.5 text-xs text-slate-600 bg-white border border-slate-300 rounded hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Dropzone / Upload Card */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-5 text-center transition-colors ${
              isDragging
                ? 'border-slate-900 bg-slate-100'
                : 'border-slate-300 bg-slate-50/70'
            }`}
          >
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-left">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-md bg-slate-900 text-white flex items-center justify-center shrink-0">
                  <Upload className="w-4 h-4" aria-hidden="true" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-900">
                    {isParsing
                      ? 'Scanning bank statement transactions & balances...'
                      : result
                      ? `Loaded: ${result.fileName}`
                      : 'Drag & drop your bank statement file here, or click Select Statement File'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Supports .xlsx, .xls, .csv, and .pdf · Auto-matches Cleared &amp; Returned cheques and captures all remaining UPI, NEFT, RTGS, Cash &amp; Bank Charge rows for Day Book
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadSampleBankStatementCSV(cheques)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sample CSV</span>
                </button>
                <button
                  type="button"
                  disabled={isParsing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    {result ? 'Upload Another File' : 'Select Statement File'}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {parseError && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-md text-xs text-red-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-700 shrink-0" />
              <span>{parseError}</span>
            </div>
          )}

          {result && (
            <>
              {/* Parse Summary Metrics & Closing Balance Strip */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-slate-500">Statement Rows</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900">
                    {result.totalRowsParsed}{' '}
                    <span className="text-[11px] font-medium text-slate-500">
                      ({result.fileType})
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                  <div className="text-emerald-800">Cleared Cheques</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-emerald-900">
                    {result.clearedMatches.length}
                  </div>
                </div>
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <div className="text-red-800">Returned Cheques</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-red-900">
                    {result.returnedMatches.length}
                  </div>
                </div>
                <div className="p-3 bg-sky-50 border border-sky-200 rounded-md">
                  <div className="text-sky-900">Other Bank Txns</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-sky-950">
                    {selectedOtherTransactions.length} /{' '}
                    {result.otherTransactions.length}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-slate-500">Statement Closing Bal.</div>
                  <div className="mt-1 text-sm font-bold font-mono-num text-slate-900 truncate">
                    {result.statementClosingBalance !== undefined
                      ? formatINR(result.statementClosingBalance)
                      : 'Not Detected'}
                  </div>
                </div>
              </div>

              {/* Projected Closing Balance Verification Bar */}
              {projectedBalanceSummary &&
                projectedBalanceSummary.stmtClosing !== undefined && (
                  <div
                    className={`px-4 py-2.5 rounded-md border text-xs flex flex-wrap items-center justify-between gap-2 ${
                      Math.abs(projectedBalanceSummary.diff ?? 0) < 0.01
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                        : 'bg-amber-50 border-amber-200 text-amber-950'
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-semibold">
                        Projected Book Closing ({selectedBank?.bankName}):{' '}
                        <span className="font-mono-num">
                          {formatINR(projectedBalanceSummary.projectedBookClosing)}
                        </span>
                      </span>
                      <span>
                        Statement Closing:{' '}
                        <strong className="font-mono-num">
                          {formatINR(projectedBalanceSummary.stmtClosing)}
                        </strong>
                      </span>
                    </div>
                    <div className="font-semibold font-mono-num flex items-center gap-1.5">
                      {Math.abs(projectedBalanceSummary.diff ?? 0) < 0.01 ? (
                        <>
                          <CheckCircle2
                            className="w-4 h-4 text-emerald-700 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Matched / Reconciled (₹0.00 Diff)</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle
                            className="w-4 h-4 text-amber-700 shrink-0"
                            aria-hidden="true"
                          />
                          <span>
                            Projected Diff:{' '}
                            {formatINR(Math.abs(projectedBalanceSummary.diff ?? 0))}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                )}

              {/* 3-Tab Segmented Navigation */}
              <div
                className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 rounded-lg border border-slate-200"
                role="tablist"
                aria-label="Reconciliation Sections"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'cleared'}
                  onClick={() => setActiveTab('cleared')}
                  className={`flex-1 min-w-[170px] px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${
                    activeTab === 'cleared'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>1. Cleared Cheques</span>
                  <span className="font-mono-num text-[11px] text-emerald-700">
                    ({selectedClearedCandidates.length}/{result.clearedMatches.length})
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'returned'}
                  onClick={() => setActiveTab('returned')}
                  className={`flex-1 min-w-[170px] px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${
                    activeTab === 'returned'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <span>2. Returned Cheques</span>
                  <span className="font-mono-num text-[11px] text-red-700">
                    ({selectedReturnedCandidates.length}/{result.returnedMatches.length})
                  </span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'other'}
                  onClick={() => setActiveTab('other')}
                  className={`flex-1 min-w-[230px] px-3.5 py-2 text-xs font-semibold rounded-md transition-colors whitespace-nowrap flex items-center justify-center gap-2 ${
                    activeTab === 'other'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>3. Other Bank Transactions → Day Book</span>
                  <span className="font-mono-num text-[11px] text-sky-700">
                    ({selectedOtherTransactions.length}/{result.otherTransactions.length})
                  </span>
                </button>
              </div>

              {/* TAB 1: CLEARED CHEQUES */}
              {activeTab === 'cleared' && (
                <div className="space-y-4">
                  {result.clearedMatches.length === 0 ? (
                    <div className="p-8 border border-slate-200 rounded-md text-center space-y-1.5">
                      <p className="text-sm font-medium text-slate-900">
                        No cleared cheques matched in this statement
                      </p>
                      <p className="text-xs text-slate-500 max-w-lg mx-auto">
                        Check Tab 2 (Returned Cheques) or Tab 3 (Other Bank Transactions → Day Book) to review remaining statement rows.
                      </p>
                    </div>
                  ) : (
                    <div className="border border-emerald-200 rounded-md overflow-hidden">
                      <div className="px-4 py-2.5 bg-emerald-50/70 border-b border-emerald-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-emerald-950">
                            Cleared / Passed Cheques ({selectedClearedCandidates.length}{' '}
                            of {result.clearedMatches.length} selected)
                          </span>
                          <span className="text-[11px] text-emerald-800">
                            · Posts automatically to Day Book
                          </span>
                        </div>
                        <span className="text-[11px] text-emerald-800">
                          Returned entries always override cleared rows · Existing Returned/Settled cheques protected
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                              <th className="py-2.5 pl-4 pr-2 w-9">
                                <input
                                  type="checkbox"
                                  aria-label="Toggle all matched cleared cheques"
                                  checked={
                                    result.clearedMatches.length > 0 &&
                                    result.clearedMatches.every(
                                      (m) => clearedSelectedMap[m.id]
                                    )
                                  }
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const next: Record<string, boolean> = {};
                                    result.clearedMatches.forEach((m) => {
                                      next[m.id] = checked;
                                    });
                                    setClearedSelectedMap(next);
                                  }}
                                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                                />
                              </th>
                              <th className="py-2.5 px-3">Cheque Number</th>
                              <th className="py-2.5 px-3">Batch &amp; Narration</th>
                              <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                              <th className="py-2.5 px-3">Bank Date</th>
                              <th className="py-2.5 px-3">Day Book Posting</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {result.clearedMatches.map((item) => {
                              const isSelected = Boolean(
                                clearedSelectedMap[item.id]
                              );
                              return (
                                <tr
                                  key={item.id}
                                  className={
                                    !isSelected
                                      ? 'opacity-50 bg-slate-50/50'
                                      : 'bg-white'
                                  }
                                >
                                  <td className="py-3 pl-4 pr-2 align-top">
                                    <input
                                      type="checkbox"
                                      aria-label={`Include cleared cheque ${item.cheque.chequeNumber}`}
                                      checked={isSelected}
                                      onChange={(e) =>
                                        setClearedSelectedMap((prev) => ({
                                          ...prev,
                                          [item.id]: e.target.checked,
                                        }))
                                      }
                                      className="mt-1 rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                                    />
                                  </td>
                                  <td className="py-3 px-3 align-top">
                                    <div className="font-mono-num font-bold text-slate-900">
                                      #{item.cheque.chequeNumber}
                                    </div>
                                    <div className="text-[11px] text-slate-600 truncate max-w-[175px]">
                                      {item.cheque.partyName}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      Chq Date:{' '}
                                      {formatIndianDate(item.cheque.chequeDate)}
                                    </div>
                                    {item.matchMethod === 'LAST_4' && (
                                      <div className="text-[10px] text-slate-500 font-mono-num mt-0.5">
                                        Last-4 match ({item.matchedStatementNumber})
                                      </div>
                                    )}
                                    {item.matchMethod === 'AMOUNT_UNIQUE' && (
                                      <div className="text-[10px] text-sky-700 font-medium mt-0.5">
                                        Unique pending amount match
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 align-top max-w-[320px]">
                                    <div className="font-mono-num font-medium text-slate-900 flex items-center gap-1.5">
                                      <span>{item.batchName}</span>
                                      {item.isBatchLocked && (
                                        <span
                                          title="Batch is locked — Status updates cleanly without unlocking"
                                          className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-amber-700"
                                        >
                                          <Lock
                                            className="w-3 h-3"
                                            aria-hidden="true"
                                          />
                                          <span>Locked</span>
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1.5 flex items-start gap-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                      <span
                                        className={`inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono-num font-bold border ${
                                          item.txnDirection === 'CR' ||
                                          item.isCredit
                                            ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                            : 'bg-amber-100 text-amber-900 border-amber-300'
                                        }`}
                                      >
                                        {item.txnDirection ||
                                          (item.isCredit ? 'CR' : 'DR')}
                                      </span>
                                      <span className="text-[10px] font-mono-num text-slate-700 whitespace-normal break-words leading-snug">
                                        {item.statementNarration}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                                    <div className="font-mono-num font-semibold text-slate-900">
                                      {formatINR(item.cheque.amount)}
                                    </div>
                                    <div className="text-[10px] font-mono-num text-emerald-700">
                                      Amount matched
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 align-top">
                                    <input
                                      type="date"
                                      aria-label={`Clearing date for cheque ${item.cheque.chequeNumber}`}
                                      value={
                                        clearedDateMap[item.id] ||
                                        item.statementDate
                                      }
                                      onChange={(e) =>
                                        setClearedDateMap((prev) => ({
                                          ...prev,
                                          [item.id]: e.target.value,
                                        }))
                                      }
                                      className="px-2 py-1 text-[11px] font-mono-num border border-slate-300 rounded bg-white"
                                    />
                                  </td>
                                  <td className="py-3 px-3 align-top space-y-1">
                                    <div className="text-[11px] font-semibold text-emerald-800">
                                      {item.isCredit !== false
                                        ? 'Receipt (CR)'
                                        : 'Payment (DR)'}
                                    </div>
                                    <div className="text-[10px] text-slate-500">
                                      {item.cheque.status} → Cleared
                                    </div>
                                    {item.alreadyCleared && (
                                      <div className="text-[10px] text-slate-500">
                                        Already Cleared in ledger
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: RETURNED CHEQUES */}
              {activeTab === 'returned' && (
                <div className="space-y-4">
                  {result.returnedMatches.length === 0 ? (
                    <div className="p-8 border border-slate-200 rounded-md text-center space-y-1.5">
                      <p className="text-sm font-medium text-slate-900">
                        No returned or bounced cheques matched in this statement
                      </p>
                      <p className="text-xs text-slate-500 max-w-lg mx-auto">
                        {result.unmatchedReturnRows.length > 0
                          ? 'Unmatched return lines were detected below — assign them to a stored cheque or review them in Tab 3.'
                          : 'No cheque return entries were detected in this statement.'}
                      </p>
                    </div>
                  ) : (
                    <div className="border border-red-200 rounded-md overflow-hidden">
                      <div className="px-4 py-2.5 bg-red-50/70 border-b border-red-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-red-950">
                            Returned / Bounced Cheques (
                            {selectedReturnedCandidates.length} of{' '}
                            {result.returnedMatches.length} selected)
                          </span>
                          <span className="text-[11px] text-red-800">
                            · Posts reversal &amp; return charges to Day Book
                          </span>
                        </div>
                        <span className="text-[11px] text-red-800">
                          Locked batches also allow Status &amp; Return Reason updates
                        </span>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                              <th className="py-2.5 pl-4 pr-2 w-9">
                                <input
                                  type="checkbox"
                                  aria-label="Toggle all matched returned cheques"
                                  checked={
                                    result.returnedMatches.length > 0 &&
                                    result.returnedMatches.every(
                                      (m) => selectedMap[m.id]
                                    )
                                  }
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    const next: Record<string, boolean> = {};
                                    result.returnedMatches.forEach((m) => {
                                      next[m.id] = checked;
                                    });
                                    setSelectedMap(next);
                                  }}
                                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                />
                              </th>
                              <th className="py-2.5 px-3">Cheque Number</th>
                              <th className="py-2.5 px-3">Batch &amp; Narration</th>
                              <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                              <th className="py-2.5 px-3">Return Date</th>
                              <th className="py-2.5 px-3 min-w-[280px]">
                                Detected Return Reason (Editable)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {result.returnedMatches.map((item) => {
                              const currentReason = reasonMap[item.id] ?? '';
                              const isPreset =
                                BOUNCE_REASONS.includes(currentReason);
                              const isSelected = Boolean(selectedMap[item.id]);

                              return (
                                <tr
                                  key={item.id}
                                  className={
                                    !isSelected
                                      ? 'opacity-50 bg-slate-50/50'
                                      : 'bg-white'
                                  }
                                >
                                  <td className="py-3 pl-4 pr-2 align-top">
                                    <input
                                      type="checkbox"
                                      aria-label={`Include cheque ${item.cheque.chequeNumber}`}
                                      checked={isSelected}
                                      onChange={(e) =>
                                        setSelectedMap((prev) => ({
                                          ...prev,
                                          [item.id]: e.target.checked,
                                        }))
                                      }
                                      className="mt-1 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                    />
                                  </td>
                                  <td className="py-3 px-3 align-top">
                                    <div className="font-mono-num font-bold text-slate-900">
                                      #{item.cheque.chequeNumber}
                                    </div>
                                    <div className="text-[11px] text-slate-600 truncate max-w-[175px]">
                                      {item.cheque.partyName}
                                    </div>
                                    <div className="text-[10px] text-slate-400">
                                      Chq Date:{' '}
                                      {formatIndianDate(item.cheque.chequeDate)}
                                    </div>
                                    {item.matchMethod === 'LAST_4' && (
                                      <div className="text-[10px] text-slate-500 font-mono-num mt-0.5">
                                        Last-4 match ({item.matchedStatementNumber})
                                      </div>
                                    )}
                                    {item.hasPassedAndReturnedPair && (
                                      <div className="text-[10px] text-red-700 font-medium mt-0.5">
                                        Passed + Returned pair → Posts both legs
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 align-top max-w-[280px]">
                                    <div className="font-mono-num font-medium text-slate-900 flex items-center gap-1.5">
                                      <span>{item.batchName}</span>
                                      {item.isBatchLocked && (
                                        <span className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-amber-700">
                                          <Lock
                                            className="w-3 h-3"
                                            aria-hidden="true"
                                          />
                                          <span>Locked</span>
                                        </span>
                                      )}
                                    </div>
                                    <div className="mt-1.5 flex items-start gap-1.5 bg-red-50/50 border border-red-200/80 rounded px-2 py-1">
                                      <span className="inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono-num font-bold border bg-red-100 text-red-900 border-red-300">
                                        {item.txnDirection ||
                                          (item.isCredit ? 'CR' : 'DR')}
                                      </span>
                                      <span className="text-[10px] font-mono-num text-slate-700 whitespace-normal break-words leading-snug">
                                        {item.statementNarration}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                                    <div className="font-mono-num font-semibold text-slate-900">
                                      {formatINR(item.cheque.amount)}
                                    </div>
                                    {item.associatedChargeAmount &&
                                      item.associatedChargeAmount > 0 && (
                                        <div className="text-[10px] font-mono-num text-red-700 font-medium mt-0.5">
                                          + Return Chg:{' '}
                                          {formatINR(item.associatedChargeAmount)}
                                        </div>
                                      )}
                                  </td>
                                  <td className="py-3 px-3 align-top">
                                    <input
                                      type="date"
                                      value={
                                        dateMap[item.id] || item.statementDate
                                      }
                                      onChange={(e) =>
                                        setDateMap((prev) => ({
                                          ...prev,
                                          [item.id]: e.target.value,
                                        }))
                                      }
                                      className="px-2 py-1 text-[11px] font-mono-num border border-slate-300 rounded bg-white"
                                    />
                                  </td>
                                  <td className="py-3 px-3 align-top space-y-1.5">
                                    <select
                                      aria-label={`Return reason preset for ${item.cheque.chequeNumber}`}
                                      value={
                                        isPreset ? currentReason : CUSTOM_OPTION
                                      }
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (val !== CUSTOM_OPTION) {
                                          setReasonMap((prev) => ({
                                            ...prev,
                                            [item.id]: val,
                                          }));
                                        } else if (isPreset) {
                                          setReasonMap((prev) => ({
                                            ...prev,
                                            [item.id]: 'Insufficient Funds',
                                          }));
                                        }
                                      }}
                                      className="w-full px-2 py-1 text-[11px] border border-slate-300 rounded bg-white text-slate-900"
                                    >
                                      {BOUNCE_REASONS.map((r) => (
                                        <option key={r} value={r}>
                                          {r}
                                        </option>
                                      ))}
                                      <option value={CUSTOM_OPTION}>
                                        Custom Reason (Specify below)
                                      </option>
                                    </select>
                                    <input
                                      type="text"
                                      value={currentReason}
                                      onChange={(e) =>
                                        setReasonMap((prev) => ({
                                          ...prev,
                                          [item.id]: e.target.value,
                                        }))
                                      }
                                      placeholder="Enter or refine reason of return..."
                                      className="w-full px-2 py-1 text-[11px] border border-slate-300 rounded bg-white text-slate-900"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Bank Return Charges & Deduplicated Entries Log */}
                  {(result.ignoredChargeRows.length > 0 ||
                    result.ignoredDuplicateRows.length > 0) && (
                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 space-y-1.5">
                      <div className="font-semibold text-slate-900">
                        Captured Bank Return Charges &amp; Deduplicated Lines (
                        {result.ignoredChargeRows.length} charge
                        {result.ignoredChargeRows.length === 1 ? '' : 's'},{' '}
                        {result.ignoredDuplicateRows.length} duplicate
                        {result.ignoredDuplicateRows.length === 1 ? '' : 's'})
                      </div>
                      <ul className="list-disc pl-5 text-[11px] text-slate-600 space-y-0.5">
                        {result.ignoredChargeRows.slice(0, 5).map((chg) => (
                          <li key={`chg-${chg.rowIndex}`}>
                            Row {chg.rowIndex} (Bank Return Charge):{' '}
                            {chg.chequeNumber
                              ? `Chq #${chg.chequeNumber}`
                              : 'Charge entry'}
                            {chg.amount > 0 ? ` · ${formatINR(chg.amount)}` : ''}{' '}
                            — {chg.narration.slice(0, 80)}
                            {chg.narration.length > 80 ? '...' : ''}
                          </li>
                        ))}
                        {result.ignoredDuplicateRows.slice(0, 3).map((dup) => (
                          <li key={`dup-${dup.rowIndex}`}>
                            Row {dup.rowIndex} (Paired / Superseded Entry):{' '}
                            {dup.chequeNumber ? `Chq #${dup.chequeNumber}` : 'Entry'}{' '}
                            — {dup.narration.slice(0, 80)}
                            {dup.narration.length > 80 ? '...' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Unmatched return rows summary */}
                  {result.unmatchedReturnRows.length > 0 && (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-950 space-y-1.5">
                      <div className="font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                        <span>
                          {result.unmatchedReturnRows.length} return statement line(s) did not match a cheque in this company (also available in Tab 3 for Day Book posting)
                        </span>
                      </div>
                      <ul className="list-disc pl-5 text-[11px] text-amber-900 space-y-2">
                        {result.unmatchedReturnRows.slice(0, 5).map((u) => (
                          <li key={u.rowIndex} className="space-y-0.5">
                            <div>
                              <span className="font-semibold">
                                Row {u.rowIndex}:
                              </span>{' '}
                              {u.chequeNumber
                                ? `Chq #${u.chequeNumber}`
                                : 'No Chq # detected'}
                              {u.amount > 0 ? ` · ${formatINR(u.amount)}` : ''} —{' '}
                              {u.narration.slice(0, 90)}
                              {u.narration.length > 90 ? '...' : ''}
                            </div>
                            {u.debugInfo?.manualReviewRequired &&
                              u.debugInfo.ambiguousCheques &&
                              u.debugInfo.ambiguousCheques.length > 1 && (
                                <div className="font-sans flex flex-wrap items-center gap-2 py-1">
                                  <span className="font-semibold text-red-800">
                                    Manual Review: select returned cheque:
                                  </span>
                                  <select
                                    aria-label={`Assign cheque for row ${u.rowIndex}`}
                                    defaultValue=""
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        handleAssignAmbiguousCheque(
                                          u.rowIndex,
                                          e.target.value
                                        );
                                      }
                                    }}
                                    className="px-2 py-1 text-[11px] font-mono-num border border-amber-400 rounded bg-white text-slate-900"
                                  >
                                    <option value="">
                                      Select matching cheque...
                                    </option>
                                    {u.debugInfo.ambiguousCheques.map((ac) => (
                                      <option key={ac.id} value={ac.id}>
                                        #{ac.chequeNumber} · {ac.partyName} ·{' '}
                                        {formatIndianDate(ac.chequeDate)} (
                                        {ac.status})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: OTHER BANK TRANSACTIONS -> POST TO DAY BOOK */}
              {activeTab === 'other' && (
                <div className="space-y-3">
                  {result.otherTransactions.length === 0 ? (
                    <div className="p-8 border border-slate-200 rounded-md text-center space-y-1.5">
                      <p className="text-sm font-medium text-slate-900">
                        All transactions in this bank statement matched cheques
                      </p>
                      <p className="text-xs text-slate-500">
                        No remaining unmatched non-cheque transactions (UPI, NEFT, RTGS, Cash, Charges, Interest) were found.
                      </p>
                    </div>
                  ) : (
                    <div className="border border-slate-200 rounded-md overflow-hidden">
                      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div>
                          <span className="font-semibold text-slate-900">
                            Other Bank Transactions → Post to Day Book (
                            {selectedOtherTransactions.length} of{' '}
                            {result.otherTransactions.length} selected)
                          </span>
                          <span className="ml-2 text-[11px] text-slate-500">
                            Smart auto-categorized — edit any Voucher Type, Party/Account Head, or Remarks before posting
                          </span>
                        </div>
                        <div className="inline-flex items-center gap-1 p-0.5 bg-white border border-slate-200 rounded-md text-[11px]">
                          {(['ALL', 'CR', 'DR'] as const).map((dir) => (
                            <button
                              key={dir}
                              type="button"
                              onClick={() => setOtherDirectionFilter(dir)}
                              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                                otherDirectionFilter === dir
                                  ? 'bg-slate-900 text-white'
                                  : 'text-slate-600 hover:text-slate-900'
                              }`}
                            >
                              {dir === 'ALL'
                                ? 'All'
                                : dir === 'CR'
                                ? 'Receipts (CR)'
                                : 'Payments (DR)'}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
                              <th className="py-2.5 pl-4 pr-2 w-9">
                                <input
                                  type="checkbox"
                                  aria-label="Toggle all other bank transactions"
                                  checked={
                                    filteredOtherTransactions.length > 0 &&
                                    filteredOtherTransactions.every((tx) => {
                                      const ed = otherEditMap[tx.id];
                                      return (
                                        ed?.included &&
                                        ed.voucherType !== 'Ignore'
                                      );
                                    })
                                  }
                                  onChange={(e) => {
                                    const checked = e.target.checked;
                                    setOtherEditMap((prev) => {
                                      const next = { ...prev };
                                      filteredOtherTransactions.forEach((tx) => {
                                        const cur = next[tx.id] || {
                                          included: true,
                                          voucherType: tx.suggestedVoucherType,
                                          partyOrLedger:
                                            tx.suggestedPartyName ||
                                            tx.suggestedLedgerCategory,
                                          narration: tx.narration,
                                          txDate: tx.txDate,
                                        };
                                        next[tx.id] = {
                                          ...cur,
                                          included: checked,
                                          voucherType:
                                            checked && cur.voucherType === 'Ignore'
                                              ? tx.suggestedVoucherType
                                              : cur.voucherType,
                                        };
                                      });
                                      return next;
                                    });
                                  }}
                                  className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                />
                              </th>
                              <th className="py-2.5 px-3 whitespace-nowrap">
                                Date &amp; Ref
                              </th>
                              <th className="py-2.5 px-3 text-right whitespace-nowrap">
                                Amount (CR / DR)
                              </th>
                              <th className="py-2.5 px-3 min-w-[180px]">
                                Voucher Type
                              </th>
                              <th className="py-2.5 px-3 min-w-[195px]">
                                Party / Account Head
                              </th>
                              <th className="py-2.5 px-3 min-w-[230px]">
                                Remarks / Narration
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {filteredOtherTransactions.map((tx) => {
                              const edit = otherEditMap[tx.id] || {
                                included: true,
                                voucherType: tx.suggestedVoucherType,
                                partyOrLedger:
                                  tx.suggestedPartyName ||
                                  tx.suggestedLedgerCategory,
                                narration: tx.narration,
                                txDate: tx.txDate,
                              };
                              const isActive =
                                edit.included && edit.voucherType !== 'Ignore';

                              return (
                                <tr
                                  key={tx.id}
                                  className={
                                    !isActive
                                      ? 'opacity-50 bg-slate-50/60'
                                      : 'bg-white'
                                  }
                                >
                                  <td className="py-2.5 pl-4 pr-2 align-top">
                                    <input
                                      type="checkbox"
                                      aria-label={`Include statement transaction row ${tx.rowIndex}`}
                                      checked={isActive}
                                      onChange={(e) => {
                                        const checked = e.target.checked;
                                        setOtherEditMap((prev) => ({
                                          ...prev,
                                          [tx.id]: {
                                            ...edit,
                                            included: checked,
                                            voucherType: checked
                                              ? edit.voucherType === 'Ignore'
                                                ? tx.suggestedVoucherType
                                                : edit.voucherType
                                              : edit.voucherType,
                                          },
                                        }));
                                      }}
                                      className="mt-1.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                                    />
                                  </td>
                                  <td className="py-2.5 px-3 align-top whitespace-nowrap">
                                    <div className="font-mono-num font-medium text-slate-900">
                                      {formatIndianDate(edit.txDate)}
                                    </div>
                                    {tx.refNo && (
                                      <div className="text-[10px] font-mono-num text-slate-500 mt-0.5 truncate max-w-[125px]">
                                        Ref: {tx.refNo}
                                      </div>
                                    )}
                                    <div className="text-[10px] text-slate-400">
                                      Row {tx.rowIndex}
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 align-top text-right whitespace-nowrap">
                                    <div
                                      className={`font-mono-num font-bold ${
                                        tx.direction === 'CR'
                                          ? 'text-emerald-700'
                                          : 'text-red-700'
                                      }`}
                                    >
                                      {tx.direction === 'CR' ? '+' : '-'}
                                      {formatINR(tx.amount)}
                                    </div>
                                    <div
                                      className={`text-[10px] font-mono-num font-semibold mt-0.5 ${
                                        tx.direction === 'CR'
                                          ? 'text-emerald-700'
                                          : 'text-red-700'
                                      }`}
                                    >
                                      {tx.direction === 'CR'
                                        ? 'CR (Credit)'
                                        : 'DR (Debit)'}
                                    </div>
                                    {tx.statementRunningBalance !== undefined && (
                                      <div className="text-[10px] font-mono-num text-slate-400 mt-0.5">
                                        Bal: {formatINR(tx.statementRunningBalance)}
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-2.5 px-3 align-top">
                                    <select
                                      aria-label={`Voucher type for row ${tx.rowIndex}`}
                                      value={edit.voucherType}
                                      onChange={(e) => {
                                        const nextType = e.target
                                          .value as VoucherChoice;
                                        setOtherEditMap((prev) => ({
                                          ...prev,
                                          [tx.id]: {
                                            ...edit,
                                            voucherType: nextType,
                                            included: nextType !== 'Ignore',
                                          },
                                        }));
                                      }}
                                      className="w-full px-2 py-1.5 text-[11px] font-medium border border-slate-300 rounded bg-white text-slate-900"
                                    >
                                      <option value="Receipt">
                                        Receipt (CR)
                                      </option>
                                      <option value="Payment">
                                        Payment (DR)
                                      </option>
                                      <option value="Contra">
                                        Contra (Cash/Bank Transfer)
                                      </option>
                                      <option value="Bank Charges">
                                        Bank Charges
                                      </option>
                                      <option value="Ignore">
                                        Ignore / Skip
                                      </option>
                                    </select>
                                  </td>
                                  <td className="py-2.5 px-3 align-top">
                                    <input
                                      type="text"
                                      list="daybook-party-ledger-options"
                                      aria-label={`Party or Account Head for row ${tx.rowIndex}`}
                                      value={edit.partyOrLedger}
                                      onChange={(e) =>
                                        setOtherEditMap((prev) => ({
                                          ...prev,
                                          [tx.id]: {
                                            ...edit,
                                            partyOrLedger: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="Customer, Vendor, or Ledger Head..."
                                      className="w-full px-2.5 py-1.5 text-[11px] border border-slate-300 rounded bg-white text-slate-900"
                                    />
                                  </td>
                                  <td className="py-2.5 px-3 align-top">
                                    <input
                                      type="text"
                                      aria-label={`Narration for row ${tx.rowIndex}`}
                                      value={edit.narration}
                                      onChange={(e) =>
                                        setOtherEditMap((prev) => ({
                                          ...prev,
                                          [tx.id]: {
                                            ...edit,
                                            narration: e.target.value,
                                          },
                                        }))
                                      }
                                      placeholder="Statement narration / remarks..."
                                      className="w-full px-2.5 py-1.5 text-[11px] font-mono-num border border-slate-300 rounded bg-white text-slate-800"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
          <div className="text-xs text-slate-600">
            {!selectedBankAccountId ? (
              <span className="text-amber-700 font-medium">
                Select or Quick-Add a Bank Account above before posting.
              </span>
            ) : result ? (
              <span>
                Ready to post:{' '}
                <strong className="font-mono-num text-emerald-700">
                  {selectedClearedCandidates.length} Cleared
                </strong>
                {' · '}
                <strong className="font-mono-num text-red-700">
                  {selectedReturnedCandidates.length} Returned
                </strong>
                {' · '}
                <strong className="font-mono-num text-sky-800">
                  {selectedOtherTransactions.length} Other Day Book Txn
                  {selectedOtherTransactions.length === 1 ? '' : 's'}
                </strong>
                {selectedBank ? ` → ${selectedBank.bankName}` : ''}
              </span>
            ) : (
              'Select an Excel, CSV, or PDF bank statement to start reconciliation.'
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                !result ||
                !selectedBankAccountId ||
                (totalActionableCount === 0 &&
                  result.statementClosingBalance === undefined)
              }
              onClick={handleConfirm}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                Confirm &amp; Post {totalActionableCount} Entry
                {totalActionableCount === 1 ? '' : 's'} to Ledger &amp; Day Book
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
