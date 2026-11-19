import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Download,
  Edit3,
  Landmark,
  Plus,
  Search,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react';
import {
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CustomerProfile,
  DayBookEntry,
  DayBookEntrySource,
  DayBookVoucherType,
} from '../types/treasury';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';
import {
  BankStatementReconcileModal,
  ReconcileConfirmPayload,
} from './BankStatementReconcileModal';

export interface ManualDayBookSubmission {
  companyBankAccountId: string;
  txDate: string;
  voucherType: DayBookVoucherType;
  direction: 'CR' | 'DR';
  amount: number;
  partyName: string;
  narration: string;
  refNo: string;
}

interface DayBookViewProps {
  companyName: string;
  bankAccounts: CompanyBankAccount[];
  cheques: ChequeEntry[];
  batches: ClearingBatch[];
  customers: CustomerProfile[];
  dayBookEntries: DayBookEntry[];
  onAddManualEntry: (submission: ManualDayBookSubmission) => void;
  onDeleteEntry: (entryId: string) => void;
  onUpdateBankAccount: (id: string, patch: Partial<CompanyBankAccount>) => void;
  onQuickAddBankAccount: (account: Omit<CompanyBankAccount, 'id'>) => string;
  onConfirmReconcile: (payload: ReconcileConfirmPayload) => void;
}

const CASH_ACCOUNT_ID = 'CASH';

const SOURCE_LABELS: Record<DayBookEntrySource, string> = {
  CLEARED_CHEQUE: 'Cleared Cheque',
  RETURNED_CHEQUE: 'Return Reversal',
  RETURN_CHARGE: 'Return Charge',
  BANK_STATEMENT: 'Bank Statement',
  MANUAL: 'Manual Entry',
};

const LEDGER_SUGGESTIONS = [
  'Bank Charges',
  'Bank Interest',
  'Cash Deposit / Withdrawal',
  'Customer / Sundry Receipt',
  'Vendor / Expense Payment',
  'Salary & Wages',
  'Office Rent & Utilities',
  'GST / Statutory Tax Payment',
  'Loan / EMI Payment',
  'Petty Cash',
  'Directors / Capital A/c',
];

function getTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMonthRange(refIso: string): { from: string; to: string } {
  const [yStr, mStr] = refIso.split('-');
  const y = Number(yStr) || new Date().getFullYear();
  const m = Number(mStr) || new Date().getMonth() + 1;
  const lastDay = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${String(m).padStart(2, '0')}-01`,
    to: `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

export function DayBookView({
  companyName,
  bankAccounts,
  cheques,
  batches,
  customers,
  dayBookEntries,
  onAddManualEntry,
  onDeleteEntry,
  onUpdateBankAccount,
  onQuickAddBankAccount,
  onConfirmReconcile,
}: DayBookViewProps) {
  const todayIso = useMemo(() => getTodayIso(), []);
  const currentMonthRange = useMemo(() => getMonthRange(todayIso), [todayIso]);

  const [datePreset, setDatePreset] = useState<'today' | 'month' | 'all' | 'custom'>('month');
  const [dateFrom, setDateFrom] = useState<string>(currentMonthRange.from);
  const [dateTo, setDateTo] = useState<string>(currentMonthRange.to);
  const [selectedBankId, setSelectedBankId] = useState<string>('ALL');
  const [voucherFilter, setVoucherFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Inline Opening / Statement Balance editor per Bank Card
  const [editingBalanceBankId, setEditingBalanceBankId] = useState<string | null>(null);
  const [draftOpeningBalance, setDraftOpeningBalance] = useState<string>('0');
  const [draftStatementClosing, setDraftStatementClosing] = useState<string>('');

  // Modals
  const [showManualModal, setShowManualModal] = useState(false);
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileBanner, setReconcileBanner] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Manual Entry form state
  const [manualAccountId, setManualAccountId] = useState<string>(
    bankAccounts.find((b) => b.isDefault)?.id ||
      bankAccounts[0]?.id ||
      CASH_ACCOUNT_ID
  );
  const [manualDate, setManualDate] = useState<string>(todayIso);
  const [manualVoucherType, setManualVoucherType] =
    useState<DayBookVoucherType>('Receipt');
  const [manualDirection, setManualDirection] = useState<'CR' | 'DR'>('CR');
  const [manualAmount, setManualAmount] = useState<string>('');
  const [manualParty, setManualParty] = useState<string>('');
  const [manualRef, setManualRef] = useState<string>('');
  const [manualNarration, setManualNarration] = useState<string>('');

  const bankMap = useMemo(
    () => new Map(bankAccounts.map((b) => [b.id, b])),
    [bankAccounts]
  );

  const partyAutocompleteList = useMemo(() => {
    const set = new Set<string>(LEDGER_SUGGESTIONS);
    customers.forEach((c) => {
      if (c.partyName?.trim()) set.add(c.partyName.trim());
    });
    cheques.forEach((c) => {
      if (c.partyName?.trim()) set.add(c.partyName.trim());
    });
    dayBookEntries.forEach((e) => {
      if (e.partyName?.trim()) set.add(e.partyName.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [customers, cheques, dayBookEntries]);

  // Multi-Bank Closing Balance Verification Summaries (full ledger per bank account)
  const bankSummaries = useMemo(() => {
    return bankAccounts.map((acc) => {
      const opening = acc.openingBalance ?? 0;
      const entries = dayBookEntries.filter(
        (e) => e.companyBankAccountId === acc.id
      );
      const totalReceipts = entries
        .filter((e) => e.direction === 'CR')
        .reduce((sum, e) => sum + e.amount, 0);
      const totalPayments = entries
        .filter((e) => e.direction === 'DR')
        .reduce((sum, e) => sum + e.amount, 0);
      const bookClosingBalance = Number(
        (opening + totalReceipts - totalPayments).toFixed(2)
      );
      const stmtClosing = acc.statementClosingBalance;
      const diff =
        stmtClosing !== undefined
          ? Number((bookClosingBalance - stmtClosing).toFixed(2))
          : undefined;
      const isMatched = diff !== undefined && Math.abs(diff) < 0.01;

      return {
        account: acc,
        opening,
        totalReceipts,
        totalPayments,
        bookClosingBalance,
        stmtClosing,
        diff,
        isMatched,
        entryCount: entries.length,
      };
    });
  }, [bankAccounts, dayBookEntries]);

  const cashSummary = useMemo(() => {
    const entries = dayBookEntries.filter(
      (e) => e.companyBankAccountId === CASH_ACCOUNT_ID
    );
    const totalReceipts = entries
      .filter((e) => e.direction === 'CR')
      .reduce((sum, e) => sum + e.amount, 0);
    const totalPayments = entries
      .filter((e) => e.direction === 'DR')
      .reduce((sum, e) => sum + e.amount, 0);
    return {
      entryCount: entries.length,
      totalReceipts,
      totalPayments,
      closingBalance: Number((totalReceipts - totalPayments).toFixed(2)),
    };
  }, [dayBookEntries]);

  // Sort all Day Book entries chronologically & calculate exact per-account running balance
  const chronologicalWithRunningBalance = useMemo(() => {
    const sorted = [...dayBookEntries].sort((a, b) => {
      const dateCmp = a.txDate.localeCompare(b.txDate);
      if (dateCmp !== 0) return dateCmp;
      return (a.createdAt || '').localeCompare(b.createdAt || '');
    });

    const runningByAccount = new Map<string, number>();
    bankAccounts.forEach((acc) => {
      runningByAccount.set(acc.id, acc.openingBalance ?? 0);
    });
    runningByAccount.set(CASH_ACCOUNT_ID, 0);

    return sorted.map((entry) => {
      const prevBal = runningByAccount.get(entry.companyBankAccountId) ?? 0;
      const nextBal = Number(
        (
          prevBal +
          (entry.direction === 'CR' ? entry.amount : -entry.amount)
        ).toFixed(2)
      );
      runningByAccount.set(entry.companyBankAccountId, nextBal);
      return {
        ...entry,
        runningBalance: nextBal,
      };
    });
  }, [dayBookEntries, bankAccounts]);

  // Opening balance brought forward as of `dateFrom` for selected scope
  const broughtForwardBalance = useMemo(() => {
    const relevantAccounts =
      selectedBankId === 'ALL'
        ? [...bankAccounts.map((b) => b.id), CASH_ACCOUNT_ID]
        : [selectedBankId];
    const relevantSet = new Set(relevantAccounts);

    let base = 0;
    for (const acc of bankAccounts) {
      if (relevantSet.has(acc.id)) {
        base += acc.openingBalance ?? 0;
      }
    }

    if (!dateFrom) return Number(base.toFixed(2));

    for (const e of dayBookEntries) {
      if (!relevantSet.has(e.companyBankAccountId)) continue;
      if (e.txDate < dateFrom) {
        base += e.direction === 'CR' ? e.amount : -e.amount;
      }
    }
    return Number(base.toFixed(2));
  }, [bankAccounts, dayBookEntries, selectedBankId, dateFrom]);

  // Apply Bank, Date Range, Voucher Type, and Search filters
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return chronologicalWithRunningBalance.filter((row) => {
      if (
        selectedBankId !== 'ALL' &&
        row.companyBankAccountId !== selectedBankId
      ) {
        return false;
      }
      if (dateFrom && row.txDate < dateFrom) return false;
      if (dateTo && row.txDate > dateTo) return false;
      if (voucherFilter !== 'ALL' && row.voucherType !== voucherFilter) {
        return false;
      }
      if (q) {
        const bank = bankMap.get(row.companyBankAccountId);
        const hay = [
          row.partyName,
          row.narration,
          row.refNo,
          row.voucherType,
          row.linkedChequeNumber || '',
          bank?.bankName || 'Cash Book',
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [
    chronologicalWithRunningBalance,
    selectedBankId,
    dateFrom,
    dateTo,
    voucherFilter,
    searchQuery,
    bankMap,
  ]);

  const periodTotals = useMemo(() => {
    const receipts = filteredRows
      .filter((r) => r.direction === 'CR')
      .reduce((sum, r) => sum + r.amount, 0);
    const payments = filteredRows
      .filter((r) => r.direction === 'DR')
      .reduce((sum, r) => sum + r.amount, 0);
    const closing = Number(
      (broughtForwardBalance + receipts - payments).toFixed(2)
    );
    return { receipts, payments, closing };
  }, [filteredRows, broughtForwardBalance]);

  const applyPreset = (preset: 'today' | 'month' | 'all') => {
    setDatePreset(preset);
    if (preset === 'today') {
      setDateFrom(todayIso);
      setDateTo(todayIso);
    } else if (preset === 'month') {
      setDateFrom(currentMonthRange.from);
      setDateTo(currentMonthRange.to);
    } else {
      setDateFrom('');
      setDateTo('');
    }
  };

  const handleOpenManualModal = () => {
    const defaultAcc =
      selectedBankId !== 'ALL'
        ? selectedBankId
        : bankAccounts.find((b) => b.isDefault)?.id ||
          bankAccounts[0]?.id ||
          CASH_ACCOUNT_ID;
    setManualAccountId(defaultAcc);
    setManualDate(todayIso);
    setManualVoucherType('Receipt');
    setManualDirection('CR');
    setManualAmount('');
    setManualParty('');
    setManualRef('');
    setManualNarration('');
    setShowManualModal(true);
  };

  const handleManualVoucherTypeChange = (next: DayBookVoucherType) => {
    setManualVoucherType(next);
    if (next === 'Receipt') {
      setManualDirection('CR');
    } else if (next === 'Payment' || next === 'Bank Charges') {
      setManualDirection('DR');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const amt = parseFloat(manualAmount.replace(/,/g, ''));
    if (!Number.isFinite(amt) || amt <= 0) return;
    if (!manualParty.trim()) return;

    onAddManualEntry({
      companyBankAccountId: manualAccountId,
      txDate: manualDate || todayIso,
      voucherType: manualVoucherType,
      direction: manualDirection,
      amount: Number(amt.toFixed(2)),
      partyName: manualParty.trim(),
      narration:
        manualNarration.trim() ||
        `${manualVoucherType} — ${manualParty.trim()}`,
      refNo: manualRef.trim(),
    });
    setShowManualModal(false);
  };

  const handleStartEditBankBalance = (acc: CompanyBankAccount) => {
    setEditingBalanceBankId(acc.id);
    setDraftOpeningBalance(String(acc.openingBalance ?? 0));
    setDraftStatementClosing(
      acc.statementClosingBalance !== undefined
        ? String(acc.statementClosingBalance)
        : ''
    );
  };

  const handleSaveBankBalance = (accId: string) => {
    const parsedOpen = parseFloat(draftOpeningBalance.replace(/,/g, ''));
    const parsedStmt = draftStatementClosing.trim()
      ? parseFloat(draftStatementClosing.replace(/,/g, ''))
      : undefined;
    onUpdateBankAccount(accId, {
      openingBalance: Number.isFinite(parsedOpen) ? parsedOpen : 0,
      statementClosingBalance:
        parsedStmt !== undefined && Number.isFinite(parsedStmt)
          ? parsedStmt
          : undefined,
    });
    setEditingBalanceBankId(null);
  };

  const handleExportExcel = () => {
    const rows = filteredRows.map((r, idx) => {
      const bank = bankMap.get(r.companyBankAccountId);
      return {
        'S.No': idx + 1,
        Date: formatIndianDate(r.txDate),
        'Bank / Cash Account': bank
          ? `${bank.bankName} (${bank.accountNumber})`
          : 'Cash Book',
        'Voucher Type': r.voucherType,
        Source: SOURCE_LABELS[r.source] || r.source,
        'Party / Account Head': r.partyName,
        'Narration / Particulars': r.narration,
        'Ref / Chq #': r.refNo || r.linkedChequeNumber || '—',
        'Receipt (CR ₹)': r.direction === 'CR' ? r.amount : 0,
        'Payment (DR ₹)': r.direction === 'DR' ? r.amount : 0,
        'Running Bank Balance (₹)': r.runningBalance,
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(
      rows.length > 0 ? rows : [{ Note: 'No Day Book entries in selected range.' }]
    );
    ws['!cols'] = [
      { wch: 6 },
      { wch: 14 },
      { wch: 30 },
      { wch: 15 },
      { wch: 16 },
      { wch: 26 },
      { wch: 42 },
      { wch: 18 },
      { wch: 16 },
      { wch: 16 },
      { wch: 22 },
    ];
    XLSX.utils.book_append_sheet(wb, ws, 'Day Book');
    const safeComp = companyName.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 28);
    XLSX.writeFile(wb, `ClearLedger_DayBook_${safeComp}_${todayIso}.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header & Primary Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold tracking-tight text-slate-900">
            Day Book (Bank &amp; Cash Book) &amp; Closing Balance Tally
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Chronological ledger of cleared cheques, return reversals, bank statement transactions, and manual entries — verified against Bank Statement Closing Balances
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowReconcileModal(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Reconcile Bank Statement</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export Excel</span>
          </button>
          <button
            type="button"
            onClick={handleOpenManualModal}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Manual Day Book Entry</span>
          </button>
        </div>
      </div>

      {reconcileBanner && (
        <div
          role="status"
          className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-950 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>{reconcileBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setReconcileBanner(null)}
            className="p-1 text-emerald-800 hover:text-emerald-950"
            aria-label="Dismiss notice"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Multi-Bank Closing Balance Verification Cards */}
      <section aria-label="Multi-Bank Closing Balance Verification">
        {bankSummaries.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-lg p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-md bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Landmark className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-slate-900">
                  No Company Bank Accounts Configured Yet
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Add a bank account with its Opening Balance to track exact Day Book running balances and verify against bank statements.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowReconcileModal(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Add Bank &amp; Reconcile Statement</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {bankSummaries.map((item) => {
              const {
                account,
                opening,
                totalReceipts,
                totalPayments,
                bookClosingBalance,
                stmtClosing,
                diff,
                isMatched,
                entryCount,
              } = item;
              const isSelectedCard = selectedBankId === account.id;
              const isEditing = editingBalanceBankId === account.id;

              return (
                <div
                  key={account.id}
                  className={`bg-white rounded-lg border transition-colors ${
                    isSelectedCard
                      ? 'border-slate-900 ring-1 ring-slate-900/10'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  {/* Card Header */}
                  <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedBankId((prev) =>
                          prev === account.id ? 'ALL' : account.id
                        )
                      }
                      className="text-left min-w-0 flex-1 group"
                    >
                      <div className="text-sm font-semibold text-slate-900 truncate group-hover:underline">
                        {account.bankName}
                      </div>
                      <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span>{account.accountType}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">
                          A/c {account.accountNumber}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono-num">
                          {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        isEditing
                          ? setEditingBalanceBankId(null)
                          : handleStartEditBankBalance(account)
                      }
                      title="Edit Opening / Statement Closing Balance"
                      className="p-1.5 text-slate-400 hover:text-slate-800 rounded hover:bg-slate-100 shrink-0"
                    >
                      <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  {/* Inline Balance Editor */}
                  {isEditing ? (
                    <div className="p-4 bg-slate-50 space-y-3 text-xs">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Opening Balance (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={draftOpeningBalance}
                          onChange={(e) => setDraftOpeningBalance(e.target.value)}
                          className="w-full px-2.5 py-1.5 font-mono-num border border-slate-300 rounded bg-white"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-slate-700 mb-1">
                          Last Bank Statement Closing Balance (₹)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={draftStatementClosing}
                          onChange={(e) =>
                            setDraftStatementClosing(e.target.value)
                          }
                          placeholder="Leave blank if not yet reconciled"
                          className="w-full px-2.5 py-1.5 font-mono-num border border-slate-300 rounded bg-white"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingBalanceBankId(null)}
                          className="px-3 py-1 text-[11px] font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSaveBankBalance(account.id)}
                          className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-semibold text-white bg-slate-900 rounded hover:bg-slate-800"
                        >
                          <Check className="w-3 h-3" aria-hidden="true" />
                          <span>Save Balances</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 space-y-3">
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                        <div>
                          <div className="text-[11px] text-slate-500">
                            Opening Balance
                          </div>
                          <div className="font-mono-num font-semibold text-slate-900 mt-0.5">
                            {formatINR(opening)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-slate-500">
                            Book Closing Balance
                          </div>
                          <div className="font-mono-num font-bold text-slate-900 mt-0.5">
                            {formatINR(bookClosingBalance)}
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] text-slate-500">
                            Total Receipts (CR)
                          </div>
                          <div className="font-mono-num font-semibold text-emerald-700 mt-0.5">
                            +{formatINR(totalReceipts)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[11px] text-slate-500">
                            Total Payments (DR)
                          </div>
                          <div className="font-mono-num font-semibold text-red-700 mt-0.5">
                            -{formatINR(totalPayments)}
                          </div>
                        </div>
                      </div>

                      <div className="pt-2.5 border-t border-slate-100 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[11px] text-slate-500">
                            Last Statement Closing
                            {account.statementClosingDate
                              ? ` (${formatIndianDate(account.statementClosingDate)})`
                              : ''}
                          </span>
                          <span className="font-mono-num font-semibold text-slate-900">
                            {stmtClosing !== undefined
                              ? formatINR(stmtClosing)
                              : '—'}
                          </span>
                        </div>

                        {/* Reconciliation Status Row */}
                        {stmtClosing !== undefined ? (
                          isMatched ? (
                            <div className="px-2.5 py-1.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5">
                                <CheckCircle2
                                  className="w-3.5 h-3.5 text-emerald-700 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>Matched / Reconciled</span>
                              </span>
                              <span className="font-mono-num">₹0.00 Diff</span>
                            </div>
                          ) : (
                            <div className="px-2.5 py-1.5 rounded bg-amber-50 border border-amber-300 text-amber-950 text-[11px] font-semibold flex items-center justify-between gap-2">
                              <span className="inline-flex items-center gap-1.5">
                                <AlertTriangle
                                  className="w-3.5 h-3.5 text-amber-700 shrink-0"
                                  aria-hidden="true"
                                />
                                <span>
                                  Difference: {formatINR(Math.abs(diff ?? 0))}
                                </span>
                              </span>
                              <span className="text-[10px] font-medium text-amber-800">
                                {(diff ?? 0) > 0 ? 'Book higher' : 'Book lower'}
                              </span>
                            </div>
                          )
                        ) : (
                          <div className="text-[11px] text-slate-400">
                            Statement balance pending — reconcile a bank statement to verify
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Cash Book Summary Card (shown if any Cash Book entries exist) */}
            {cashSummary.entryCount > 0 && (
              <div
                className={`bg-white rounded-lg border transition-colors ${
                  selectedBankId === CASH_ACCOUNT_ID
                    ? 'border-slate-900 ring-1 ring-slate-900/10'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedBankId((prev) =>
                        prev === CASH_ACCOUNT_ID ? 'ALL' : CASH_ACCOUNT_ID
                      )
                    }
                    className="text-left flex-1 group"
                  >
                    <div className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 group-hover:underline">
                      <Wallet className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
                      <span>Cash Book / Petty Cash</span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 font-mono-num">
                      {cashSummary.entryCount}{' '}
                      {cashSummary.entryCount === 1 ? 'entry' : 'entries'}
                    </div>
                  </button>
                </div>
                <div className="p-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs">
                  <div>
                    <div className="text-[11px] text-slate-500">
                      Cash Receipts (CR)
                    </div>
                    <div className="font-mono-num font-semibold text-emerald-700 mt-0.5">
                      +{formatINR(cashSummary.totalReceipts)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-slate-500">
                      Cash Payments (DR)
                    </div>
                    <div className="font-mono-num font-semibold text-red-700 mt-0.5">
                      -{formatINR(cashSummary.totalPayments)}
                    </div>
                  </div>
                  <div className="col-span-2 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[11px] text-slate-500">
                      Cash Closing Balance
                    </span>
                    <span className="font-mono-num font-bold text-slate-900">
                      {formatINR(cashSummary.closingBalance)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Filter Bar & Chronological Day Book Table */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Filter Toolbar */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Date Range Presets + Custom Pickers */}
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex items-center p-0.5 bg-white border border-slate-200 rounded-md text-xs"
                role="group"
                aria-label="Date range presets"
              >
                <button
                  type="button"
                  onClick={() => applyPreset('today')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    datePreset === 'today'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('month')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    datePreset === 'month'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Current Month
                </button>
                <button
                  type="button"
                  onClick={() => applyPreset('all')}
                  className={`px-2.5 py-1 rounded font-medium transition-colors whitespace-nowrap ${
                    datePreset === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All Dates
                </button>
              </div>

              <div className="flex items-center gap-1.5 text-xs">
                <input
                  type="date"
                  aria-label="From Date"
                  value={dateFrom}
                  onChange={(e) => {
                    setDateFrom(e.target.value);
                    setDatePreset('custom');
                  }}
                  className="px-2.5 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-md"
                />
                <span className="text-slate-400">to</span>
                <input
                  type="date"
                  aria-label="To Date"
                  value={dateTo}
                  onChange={(e) => {
                    setDateTo(e.target.value);
                    setDatePreset('custom');
                  }}
                  className="px-2.5 py-1.5 text-xs font-mono-num bg-white border border-slate-300 rounded-md"
                />
              </div>
            </div>

            {/* Bank Account, Voucher Type & Search */}
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Filter by Bank Account"
                value={selectedBankId}
                onChange={(e) => setSelectedBankId(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md text-slate-900"
              >
                <option value="ALL">All Banks ({bankAccounts.length})</option>
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} ({acc.accountNumber.slice(-4)})
                  </option>
                ))}
                <option value={CASH_ACCOUNT_ID}>Cash Book / Petty Cash</option>
              </select>

              <select
                aria-label="Filter by Voucher Type"
                value={voucherFilter}
                onChange={(e) => setVoucherFilter(e.target.value)}
                className="px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md text-slate-900"
              >
                <option value="ALL">All Vouchers</option>
                <option value="Receipt">Receipt (CR)</option>
                <option value="Payment">Payment (DR)</option>
                <option value="Contra">Contra</option>
                <option value="Bank Charges">Bank Charges</option>
              </select>

              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search party, ref, narration..."
                  className="pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-md w-52 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>
            </div>
          </div>

          {filteredRows.length === 0 &&
            dayBookEntries.length > 0 &&
            datePreset !== 'all' && (
              <div className="px-3 py-2 rounded bg-sky-50 border border-sky-200 text-xs text-sky-950 flex flex-wrap items-center justify-between gap-2">
                <span>
                  No entries fall within the selected date range, though{' '}
                  <strong className="font-mono-num">
                    {dayBookEntries.length}
                  </strong>{' '}
                  Day Book{' '}
                  {dayBookEntries.length === 1 ? 'entry exists' : 'entries exist'}{' '}
                  on other dates.
                </span>
                <button
                  type="button"
                  onClick={() => applyPreset('all')}
                  className="font-semibold underline text-sky-900 hover:text-slate-900"
                >
                  Show All Dates
                </button>
              </div>
            )}
        </div>

        {/* Ledger Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                <th className="py-2.5 pl-4 pr-3 whitespace-nowrap">Date</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Bank Account</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Voucher Type</th>
                <th className="py-2.5 px-3 min-w-[260px]">
                  Party / Particulars
                </th>
                <th className="py-2.5 px-3 whitespace-nowrap">Ref / Chq #</th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  Receipt (CR ₹)
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  Payment (DR ₹)
                </th>
                <th className="py-2.5 px-3 text-right whitespace-nowrap">
                  Running Bank Balance (₹)
                </th>
                <th className="py-2.5 pl-2 pr-4 w-10 text-right">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {/* Opening Balance Brought Forward Row */}
              {(bankAccounts.length > 0 || dayBookEntries.length > 0) && (
                <tr className="bg-slate-50/70 font-medium text-slate-700">
                  <td className="py-2.5 pl-4 pr-3 font-mono-num whitespace-nowrap">
                    {dateFrom ? formatIndianDate(dateFrom) : 'Opening'}
                  </td>
                  <td className="py-2.5 px-3 whitespace-nowrap">
                    {selectedBankId === 'ALL'
                      ? 'All Accounts'
                      : selectedBankId === CASH_ACCOUNT_ID
                      ? 'Cash Book'
                      : bankMap.get(selectedBankId)?.bankName || 'Bank Account'}
                  </td>
                  <td className="py-2.5 px-3 text-slate-500">Opening b/f</td>
                  <td className="py-2.5 px-3 text-slate-600" colSpan={2}>
                    Opening Balance Brought Forward
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono-num text-slate-400">
                    —
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono-num text-slate-400">
                    —
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-slate-900 whitespace-nowrap">
                    {formatINR(broughtForwardBalance)}
                  </td>
                  <td className="py-2.5 pl-2 pr-4" />
                </tr>
              )}

              {filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 px-6 text-center">
                    <div className="max-w-md mx-auto space-y-2">
                      <BookOpen
                        className="w-7 h-7 text-slate-300 mx-auto"
                        aria-hidden="true"
                      />
                      <div className="text-sm font-semibold text-slate-900">
                        {dayBookEntries.length === 0
                          ? 'Your Day Book is ready for entries'
                          : 'No entries match your active filters'}
                      </div>
                      <p className="text-xs text-slate-500">
                        {dayBookEntries.length === 0
                          ? 'Upload a bank statement to auto-post cleared cheques, returned cheques, and remaining UPI/NEFT/Cash/Charge transactions — or record a manual entry.'
                          : 'Adjust the date range, bank account selector, or search query to inspect other transactions.'}
                      </p>
                      {dayBookEntries.length === 0 && (
                        <div className="pt-2 flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowReconcileModal(true)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
                          >
                            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Reconcile Bank Statement</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleOpenManualModal}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                          >
                            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Manual Day Book Entry</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => {
                  const bank = bankMap.get(row.companyBankAccountId);
                  const isCash = row.companyBankAccountId === CASH_ACCOUNT_ID;
                  const voucherColor =
                    row.voucherType === 'Receipt'
                      ? 'text-emerald-800'
                      : row.voucherType === 'Bank Charges'
                      ? 'text-amber-800'
                      : row.voucherType === 'Contra'
                      ? 'text-sky-800'
                      : 'text-red-800';

                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-slate-50/80 transition-colors"
                    >
                      <td className="py-2.5 pl-4 pr-3 align-top font-mono-num text-slate-900 whitespace-nowrap">
                        {formatIndianDate(row.txDate)}
                      </td>
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className="font-medium text-slate-900">
                          {isCash
                            ? 'Cash Book'
                            : bank?.bankName || 'Unknown Bank'}
                        </div>
                        {bank && (
                          <div className="text-[10px] font-mono-num text-slate-500">
                            A/c ···{bank.accountNumber.slice(-4)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top whitespace-nowrap">
                        <div className={`font-semibold ${voucherColor}`}>
                          {row.voucherType}
                        </div>
                        <div className="text-[10px] text-slate-500">
                          {SOURCE_LABELS[row.source] || row.source}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 align-top max-w-[360px]">
                        <div className="font-semibold text-slate-900">
                          {row.partyName}
                        </div>
                        {row.narration && row.narration !== row.partyName && (
                          <div className="text-[11px] text-slate-600 mt-0.5 break-words leading-snug">
                            {row.narration}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 align-top font-mono-num text-slate-700 whitespace-nowrap">
                        {row.refNo ||
                          (row.linkedChequeNumber
                            ? `#${row.linkedChequeNumber}`
                            : '—')}
                      </td>
                      <td className="py-2.5 px-3 align-top text-right font-mono-num font-semibold text-emerald-700 whitespace-nowrap">
                        {row.direction === 'CR' ? formatINR(row.amount) : '—'}
                      </td>
                      <td className="py-2.5 px-3 align-top text-right font-mono-num font-semibold text-red-700 whitespace-nowrap">
                        {row.direction === 'DR' ? formatINR(row.amount) : '—'}
                      </td>
                      <td className="py-2.5 px-3 align-top text-right font-mono-num font-bold text-slate-900 whitespace-nowrap">
                        {formatINR(row.runningBalance)}
                      </td>
                      <td className="py-2.5 pl-2 pr-4 align-top text-right whitespace-nowrap">
                        {confirmDeleteId === row.id ? (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                onDeleteEntry(row.id);
                                setConfirmDeleteId(null);
                              }}
                              className="px-1.5 py-0.5 text-[10px] font-semibold text-white bg-red-700 rounded hover:bg-red-800"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="px-1.5 py-0.5 text-[10px] text-slate-600 hover:text-slate-900"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(row.id)}
                            title="Remove Day Book entry"
                            className="p-1 text-slate-400 hover:text-red-700 rounded hover:bg-red-50 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>

            {filteredRows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold text-slate-900">
                  <td colSpan={5} className="py-3 pl-4 pr-3 text-xs">
                    Period Totals ({filteredRows.length}{' '}
                    {filteredRows.length === 1 ? 'entry' : 'entries'})
                    {selectedBankId === 'ALL'
                      ? ' — Combined Closing Balance'
                      : ' — Account Closing Balance'}
                  </td>
                  <td className="py-3 px-3 text-right font-mono-num text-emerald-700 whitespace-nowrap">
                    +{formatINR(periodTotals.receipts)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono-num text-red-700 whitespace-nowrap">
                    -{formatINR(periodTotals.payments)}
                  </td>
                  <td className="py-3 px-3 text-right font-mono-num font-bold text-slate-900 whitespace-nowrap">
                    {formatINR(periodTotals.closing)}
                  </td>
                  <td className="py-3 pl-2 pr-4" />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {/* Manual Day Book Entry Modal */}
      {showManualModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-daybook-modal-title"
        >
          <div className="w-full max-w-lg bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
              <div>
                <h3
                  id="manual-daybook-modal-title"
                  className="text-sm font-semibold text-slate-900"
                >
                  New Manual Day Book Entry
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Record manual cash or bank receipts, payments, contra transfers, or bank charges
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700"
                aria-label="Close manual entry modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="p-5 space-y-4 text-xs">
              <datalist id="manual-daybook-parties">
                {partyAutocompleteList.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Transaction Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Bank / Cash Account *
                  </label>
                  <select
                    required
                    value={manualAccountId}
                    onChange={(e) => setManualAccountId(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                  >
                    {bankAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.bankName} ({acc.accountNumber.slice(-4)})
                      </option>
                    ))}
                    <option value={CASH_ACCOUNT_ID}>
                      Cash Book / Petty Cash
                    </option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Voucher Type *
                  </label>
                  <select
                    value={manualVoucherType}
                    onChange={(e) =>
                      handleManualVoucherTypeChange(
                        e.target.value as DayBookVoucherType
                      )
                    }
                    className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                  >
                    <option value="Receipt">Receipt (CR)</option>
                    <option value="Payment">Payment (DR)</option>
                    <option value="Contra">Contra (Cash/Bank Transfer)</option>
                    <option value="Bank Charges">Bank Charges (DR)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Amount (₹) *
                  </label>
                  <input
                    type="number"
                    required
                    min="0.01"
                    step="0.01"
                    value={manualAmount}
                    onChange={(e) => setManualAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-md bg-white"
                  />
                </div>
              </div>

              {manualVoucherType === 'Contra' && (
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Contra Flow Direction
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setManualDirection('CR')}
                      className={`py-2 px-3 rounded-md border font-medium text-xs transition-colors ${
                        manualDirection === 'CR'
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                          : 'bg-white border-slate-300 text-slate-600'
                      }`}
                    >
                      Credit (+CR) · Deposit to Account
                    </button>
                    <button
                      type="button"
                      onClick={() => setManualDirection('DR')}
                      className={`py-2 px-3 rounded-md border font-medium text-xs transition-colors ${
                        manualDirection === 'DR'
                          ? 'bg-red-50 border-red-500 text-red-900'
                          : 'bg-white border-slate-300 text-slate-600'
                      }`}
                    >
                      Debit (-DR) · Withdrawal from Account
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Party / Account Head *
                  </label>
                  <input
                    type="text"
                    required
                    list="manual-daybook-parties"
                    value={manualParty}
                    onChange={(e) => setManualParty(e.target.value)}
                    placeholder="Customer, Vendor, or Ledger Head"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 mb-1">
                    Ref / UTR / Cheque No.
                  </label>
                  <input
                    type="text"
                    value={manualRef}
                    onChange={(e) => setManualRef(e.target.value)}
                    placeholder="Optional reference number"
                    className="w-full px-3 py-2 font-mono-num border border-slate-300 rounded-md bg-white"
                  />
                </div>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">
                  Narration / Remarks
                </label>
                <input
                  type="text"
                  value={manualNarration}
                  onChange={(e) => setManualNarration(e.target.value)}
                  placeholder="Enter transaction remarks or narration..."
                  className="w-full px-3 py-2 border border-slate-300 rounded-md bg-white"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowManualModal(false)}
                  className="px-4 py-2 font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800"
                >
                  Post to Day Book
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bank Statement Reconciliation Modal directly accessible from Day Book */}
      {showReconcileModal && (
        <BankStatementReconcileModal
          cheques={cheques}
          batches={batches}
          bankAccounts={bankAccounts}
          customers={customers}
          existingDayBookEntries={dayBookEntries}
          defaultBankAccountId={
            selectedBankId !== 'ALL' && selectedBankId !== CASH_ACCOUNT_ID
              ? selectedBankId
              : undefined
          }
          onQuickAddBankAccount={onQuickAddBankAccount}
          onConfirmReconcile={(payload) => {
            onConfirmReconcile(payload);
            const clearedCount = payload.chequeUpdates.filter(
              (u) => u.matchType === 'CLEARED' || u.targetStatus === 'Cleared'
            ).length;
            const returnedCount = payload.chequeUpdates.length - clearedCount;
            const otherCount = payload.otherTransactions.length;
            setReconcileBanner(
              `Posted "${payload.fileName}" to Day Book: ${clearedCount} cleared cheque(s), ${returnedCount} returned cheque(s), and ${otherCount} other bank transaction(s).`
            );
            setShowReconcileModal(false);
          }}
          onClose={() => setShowReconcileModal(false)}
        />
      )}
    </div>
  );
}
