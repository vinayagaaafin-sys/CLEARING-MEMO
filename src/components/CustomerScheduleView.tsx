import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit3,
  FileImage,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { MAJOR_INDIAN_BANKS } from '../data/indianBanks';
import {
  BankHoliday,
  ChequeEntry,
  CompanyBankAccount,
  CustomerChequeSchedule,
  CustomerProfile,
  ScheduleFrequency,
  ScheduleScanDocument,
  ScheduledChequeItem,
} from '../types/treasury';
import {
  generateRecurringChequeItems,
  resolveEffectiveWorkingDate,
  toIsoDate,
} from '../utils/bankHolidays';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';
import {
  DailyDepositScheduleWidget,
  SendToClearingSelection,
} from './DailyDepositScheduleWidget';
import { ScheduleDocumentScanner } from './ScheduleDocumentScanner';

interface CustomerScheduleViewProps {
  schedules: CustomerChequeSchedule[];
  bankAccounts: CompanyBankAccount[];
  customers?: CustomerProfile[];
  cheques: ChequeEntry[];
  holidays: BankHoliday[];
  onSaveSchedule: (
    schedule: Omit<CustomerChequeSchedule, 'id' | 'createdAt' | 'updatedAt'>,
    existingId?: string
  ) => void;
  onDeleteSchedule: (scheduleId: string) => void;
  onOpenBankHolidays: () => void;
  onSendToClearingBatch: (
    selections: SendToClearingSelection[],
    depositDate: string,
    companyBankAccountId: string
  ) => void;
}

export function CustomerScheduleView({
  schedules,
  bankAccounts,
  customers = [],
  cheques,
  holidays,
  onSaveSchedule,
  onDeleteSchedule,
  onOpenBankHolidays,
  onSendToClearingBatch,
}: CustomerScheduleViewProps) {
  const todayIso = toIsoDate(new Date());

  const [viewMode, setViewMode] = useState<'overview' | 'editor'>('overview');
  const [editingScheduleId, setEditingScheduleId] = useState<string | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedScheduleId, setExpandedScheduleId] = useState<string | null>(
    null
  );

  // Editor form state
  const [customerName, setCustomerName] = useState('');
  const [customerCode, setCustomerCode] = useState('');
  const [customerSearchPick, setCustomerSearchPick] = useState('');
  const [loanRefNo, setLoanRefNo] = useState('');
  const [draweeBank, setDraweeBank] = useState('');
  const [draweeBranch, setDraweeBranch] = useState('');
  const [companyBankAccountId, setCompanyBankAccountId] = useState(
    bankAccounts.find((b) => b.isDefault)?.id || bankAccounts[0]?.id || ''
  );
  const [holidayAutoShift, setHolidayAutoShift] = useState(true);
  const [scheduleMode, setScheduleMode] = useState<'auto' | 'manual'>('auto');

  // Auto-generate controls
  const [startDate, setStartDate] = useState(todayIso);
  const [frequency, setFrequency] = useState<ScheduleFrequency>('Monthly');
  const [customIntervalDays, setCustomIntervalDays] = useState('30');
  const [chequeCount, setChequeCount] = useState('6');
  const [startingChequeNo, setStartingChequeNo] = useState('000101');
  const [amountPerCheque, setAmountPerCheque] = useState('25000');

  // Rows & attached scans
  const [rows, setRows] = useState<ScheduledChequeItem[]>([]);
  const [scannedDocs, setScannedDocs] = useState<ScheduleScanDocument[]>([]);
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const partyDirectory = useMemo(() => {
    const map = new Map<string, { name: string; code: string }>();
    for (const c of customers) {
      const n = c.partyName.trim();
      if (n) {
        map.set(n.toLowerCase(), { name: n, code: c.customerCode || '' });
      }
    }
    for (const chq of cheques) {
      const n = chq.partyName.trim();
      if (n && !map.has(n.toLowerCase())) {
        map.set(n.toLowerCase(), { name: n, code: chq.customerCode || '' });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [customers, cheques]);

  const startNewSchedule = () => {
    setEditingScheduleId(null);
    setCustomerName('');
    setCustomerCode('');
    setCustomerSearchPick('');
    setLoanRefNo('');
    setDraweeBank('');
    setDraweeBranch('');
    setCompanyBankAccountId(
      bankAccounts.find((b) => b.isDefault)?.id || bankAccounts[0]?.id || ''
    );
    setHolidayAutoShift(true);
    setScheduleMode('auto');
    setStartDate(todayIso);
    setFrequency('Monthly');
    setCustomIntervalDays('30');
    setChequeCount('6');
    setStartingChequeNo('000101');
    setAmountPerCheque('25000');
    setScannedDocs([]);
    setNotes('');
    setFormError(null);

    const initialRows = generateRecurringChequeItems({
      startDate: todayIso,
      frequency: 'Monthly',
      count: 6,
      startingChequeNumber: '000101',
      amountPerCheque: 25000,
      holidayAutoShift: true,
      holidays,
    });
    setRows(initialRows);
    setViewMode('editor');
  };

  const startEditSchedule = (sch: CustomerChequeSchedule) => {
    setEditingScheduleId(sch.id);
    setCustomerName(sch.customerName);
    setCustomerCode(sch.customerCode || '');
    setCustomerSearchPick('');
    setLoanRefNo(sch.loanRefNo);
    setDraweeBank(sch.draweeBank);
    setDraweeBranch(sch.draweeBranch);
    setCompanyBankAccountId(
      sch.companyBankAccountId ||
        bankAccounts.find((b) => b.isDefault)?.id ||
        bankAccounts[0]?.id ||
        ''
    );
    setHolidayAutoShift(sch.holidayAutoShift);
    setScheduleMode(sch.mode);
    setStartDate(sch.startDate || sch.cheques[0]?.originalDate || todayIso);
    setFrequency(sch.frequency || 'Monthly');
    setCustomIntervalDays(String(sch.customIntervalDays || 30));
    setChequeCount(String(sch.cheques.length || 1));
    setStartingChequeNo(sch.cheques[0]?.chequeNumber || '000101');
    setAmountPerCheque(String(sch.cheques[0]?.amount || 25000));
    setRows(sch.cheques);
    setScannedDocs(sch.scannedDocuments || []);
    setNotes(sch.notes || '');
    setFormError(null);
    setViewMode('editor');
  };

  const handleToggleHolidayAutoShift = (nextShift: boolean) => {
    setHolidayAutoShift(nextShift);
    setRows((prev) =>
      prev.map((item) => {
        if (item.status !== 'Scheduled') return item;
        const resolved = resolveEffectiveWorkingDate(
          item.originalDate,
          nextShift,
          holidays
        );
        return {
          ...item,
          effectiveDate: resolved.effectiveDate,
          shiftReason: resolved.shiftReason || resolved.leaveWarning,
        };
      })
    );
  };

  const handleAutoGenerateRows = () => {
    const countNum = Math.max(1, Math.min(120, Number(chequeCount) || 1));
    const amtNum = Math.max(0, Number(amountPerCheque) || 0);
    const customDays = Math.max(1, Number(customIntervalDays) || 30);

    // Preserve already-in-clearing / cleared items when editing
    const lockedRows = rows.filter((r) => r.status !== 'Scheduled');
    const generated = generateRecurringChequeItems({
      startDate,
      frequency,
      customIntervalDays: customDays,
      count: countNum,
      startingChequeNumber: startingChequeNo || '000101',
      amountPerCheque: amtNum,
      holidayAutoShift,
      holidays,
    });
    setRows([...lockedRows, ...generated]);
  };

  const handleAddManualRow = () => {
    const lastRow = rows[rows.length - 1];
    const nextDate = lastRow?.originalDate || todayIso;
    const prevDigits = lastRow?.chequeNumber.match(/(\d+)$/);
    const nextChqNo = prevDigits
      ? lastRow.chequeNumber.replace(
          /(\d+)$/,
          String(parseInt(prevDigits[1], 10) + 1).padStart(
            prevDigits[1].length,
            '0'
          )
        )
      : '000101';
    const resolved = resolveEffectiveWorkingDate(
      nextDate,
      holidayAutoShift,
      holidays
    );
    setRows((prev) => [
      ...prev,
      {
        id: `sch-chq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        chequeNumber: nextChqNo,
        originalDate: nextDate,
        effectiveDate: resolved.effectiveDate,
        shiftReason: resolved.shiftReason || resolved.leaveWarning,
        amount: lastRow?.amount ?? 25000,
        status: 'Scheduled',
      },
    ]);
  };

  const handleUpdateRow = (
    rowId: string,
    patch: Partial<{ chequeNumber: string; originalDate: string; amount: number }>
  ) => {
    setRows((prev) =>
      prev.map((item) => {
        if (item.id !== rowId) return item;
        const nextOriginal = patch.originalDate ?? item.originalDate;
        const resolved =
          item.status === 'Scheduled'
            ? resolveEffectiveWorkingDate(nextOriginal, holidayAutoShift, holidays)
            : null;
        return {
          ...item,
          ...patch,
          originalDate: nextOriginal,
          effectiveDate: resolved ? resolved.effectiveDate : item.effectiveDate,
          shiftReason: resolved
            ? resolved.shiftReason || resolved.leaveWarning
            : item.shiftReason,
        };
      })
    );
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.id !== rowId));
  };

  const handleSubmitSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim()) {
      setFormError('Customer / Party Name is required.');
      return;
    }
    if (rows.length === 0) {
      setFormError('Add or generate at least one scheduled cheque row.');
      return;
    }

    onSaveSchedule(
      {
        customerName: customerName.trim(),
        customerCode: customerCode.trim() || undefined,
        loanRefNo: loanRefNo.trim(),
        draweeBank: draweeBank.trim(),
        draweeBranch: draweeBranch.trim(),
        companyBankAccountId: companyBankAccountId || undefined,
        holidayAutoShift,
        mode: scheduleMode,
        frequency: scheduleMode === 'auto' ? frequency : undefined,
        customIntervalDays:
          scheduleMode === 'auto' && frequency === 'Custom'
            ? Number(customIntervalDays) || 30
            : undefined,
        startDate: scheduleMode === 'auto' ? startDate : undefined,
        cheques: rows,
        scannedDocuments: scannedDocs,
        notes: notes.trim() || undefined,
      },
      editingScheduleId || undefined
    );

    setViewMode('overview');
    setEditingScheduleId(null);
  };

  const filteredSchedules = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return schedules;
    return schedules.filter((sch) => {
      const hay = `${sch.customerName} ${sch.loanRefNo} ${sch.draweeBank} ${sch.draweeBranch} ${sch.cheques
        .map((c) => c.chequeNumber)
        .join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }, [schedules, searchQuery]);

  if (viewMode === 'editor') {
    const editorTotalAmount = rows.reduce((s, r) => s + (r.amount || 0), 0);
    const shiftedRowsCount = rows.filter(
      (r) => r.effectiveDate !== r.originalDate
    ).length;

    return (
      <div className="space-y-5">
        {/* Top Editor Header */}
        <div className="bg-white border border-slate-200 rounded-lg px-5 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode('overview')}
              className="p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              title="Back to Customer Schedules"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                {editingScheduleId
                  ? 'Edit Customer PDC / EMI Cheque Schedule'
                  : 'New Customer PDC / EMI Cheque Schedule'}
              </h2>
              <p className="text-xs text-slate-500">
                Enter EMI / recurring cheque details on the left while inspecting scanned cheque leaves on the right.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenBankHolidays}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap"
            >
              <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Bank Holidays ({holidays.length})</span>
            </button>
          </div>
        </div>

        {/* Split-Screen: Left Panel (Schedule Form) + Right Panel (Integrated Document Scanner ONLY Here) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Panel: Customer & Cheque Schedule Form */}
          <form
            onSubmit={handleSubmitSchedule}
            className="xl:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-5"
          >
            {formError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md text-xs text-red-800 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Customer & Loan Metadata */}
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                <h3 className="text-sm font-semibold text-slate-900">
                  1. Customer &amp; Loan Particulars
                </h3>
                <span className="text-[11px] font-mono-num text-slate-500">
                  {rows.length} Cheques · {formatINR(editorTotalAmount)}
                </span>
              </div>

              {partyDirectory.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Quick-Select Existing Customer
                  </label>
                  <select
                    value={customerSearchPick}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCustomerSearchPick(val);
                      const found = partyDirectory.find(
                        (p) => p.name.toLowerCase() === val
                      );
                      if (found) {
                        setCustomerName(found.name);
                        if (found.code) setCustomerCode(found.code);
                      }
                    }}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-800"
                  >
                    <option value="">
                      -- Pick from {partyDirectory.length} saved customers or type below --
                    </option>
                    {partyDirectory.map((p) => (
                      <option key={p.name} value={p.name.toLowerCase()}>
                        {p.name}
                        {p.code ? ` (${p.code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Customer / Party Name <span className="text-red-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={customerName}
                    onChange={(e) => {
                      setCustomerName(e.target.value);
                      setCustomerSearchPick('');
                    }}
                    placeholder="e.g., M/s. Sri Murugan Traders"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Loan / Agreement / Ref No
                  </label>
                  <input
                    type="text"
                    value={loanRefNo}
                    onChange={(e) => setLoanRefNo(e.target.value)}
                    placeholder="e.g., LN/2026/EMI-409"
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Drawee Bank Name
                  </label>
                  <input
                    type="text"
                    list="pdc-bank-presets"
                    value={draweeBank}
                    onChange={(e) => setDraweeBank(e.target.value)}
                    placeholder="e.g., Indian Overseas Bank"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  />
                  <datalist id="pdc-bank-presets">
                    {MAJOR_INDIAN_BANKS.map((b) => (
                      <option key={b.shortCode} value={b.name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Drawee Branch Name
                  </label>
                  <input
                    type="text"
                    value={draweeBranch}
                    onChange={(e) => setDraweeBranch(e.target.value)}
                    placeholder="e.g., Ashok Nagar, Chennai"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Deposit Account (Company)
                  </label>
                  <select
                    value={companyBankAccountId}
                    onChange={(e) => setCompanyBankAccountId(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-slate-300 rounded-md bg-white"
                  >
                    {bankAccounts.length === 0 ? (
                      <option value="">Default Bank</option>
                    ) : (
                      bankAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.bankName} ({acc.accountNumber})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
            </div>

            {/* Holiday Auto-Shift Toggle */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-slate-900">
                  Holiday Auto-Shift (Sundays, 2nd/4th Saturdays &amp; Bank Holidays)
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Automatically moves leave-day PDC dates to the next working bank day.
                  {shiftedRowsCount > 0 && (
                    <span className="ml-1 font-semibold text-amber-800">
                      ({shiftedRowsCount} cheque{shiftedRowsCount === 1 ? '' : 's'} shifted)
                    </span>
                  )}
                </p>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={holidayAutoShift}
                  onChange={(e) => handleToggleHolidayAutoShift(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900"
                />
                <span className="text-xs font-semibold text-slate-900">
                  {holidayAutoShift ? 'Auto-Shift ON' : 'Auto-Shift OFF'}
                </span>
              </label>
            </div>

            {/* Schedule Mode Selector */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2.5">
                <h3 className="text-sm font-semibold text-slate-900">
                  2. Cheque Schedule Builder
                </h3>
                <div className="inline-flex p-0.5 bg-slate-100 border border-slate-200 rounded-md">
                  <button
                    type="button"
                    onClick={() => setScheduleMode('auto')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      scheduleMode === 'auto'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Auto-Generate EMI / Recurring
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('manual')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      scheduleMode === 'manual'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Manual Multi-Cheque Rows
                  </button>
                </div>
              </div>

              {scheduleMode === 'auto' && (
                <div className="p-4 bg-slate-50/70 border border-slate-200 rounded-md space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Frequency
                      </label>
                      <select
                        value={frequency}
                        onChange={(e) =>
                          setFrequency(e.target.value as ScheduleFrequency)
                        }
                        className="w-full px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      >
                        <option value="Monthly">Monthly</option>
                        <option value="Weekly">Weekly</option>
                        <option value="Custom">Custom Days</option>
                      </select>
                    </div>
                    {frequency === 'Custom' ? (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Interval (Days)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={customIntervalDays}
                          onChange={(e) => setCustomIntervalDays(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Number of Cheques
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={chequeCount}
                          onChange={(e) => setChequeCount(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                        />
                      </div>
                    )}
                    {frequency === 'Custom' && (
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 mb-1">
                          Number of Cheques
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={chequeCount}
                          onChange={(e) => setChequeCount(e.target.value)}
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                        />
                      </div>
                    )}
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Starting Cheque No.
                      </label>
                      <input
                        type="text"
                        value={startingChequeNo}
                        onChange={(e) => setStartingChequeNo(e.target.value)}
                        placeholder="000101"
                        className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 mb-1">
                        Amount per Cheque (₹)
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={amountPerCheque}
                        onChange={(e) => setAmountPerCheque(e.target.value)}
                        className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-slate-300 rounded bg-white"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={handleAutoGenerateRows}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Generate Schedule Rows</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Scheduled Cheque Rows Table */}
              <div className="border border-slate-200 rounded-md overflow-hidden">
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10 border-b border-slate-200 text-[11px] font-semibold text-slate-600">
                      <tr>
                        <th className="py-2 px-2.5 w-10 text-center">#</th>
                        <th className="py-2 px-2.5">Cheque No.</th>
                        <th className="py-2 px-2.5">EMI / Cheque Date</th>
                        <th className="py-2 px-2.5">Effective Deposit Date</th>
                        <th className="py-2 px-2.5 text-right">Amount (₹)</th>
                        <th className="py-2 px-2 w-9" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-xs">
                      {rows.map((row, idx) => {
                        const isLockedRow = row.status !== 'Scheduled';
                        const wasShifted =
                          row.effectiveDate !== row.originalDate;
                        const isLeaveWarning =
                          !wasShifted &&
                          Boolean(row.shiftReason?.startsWith('Falls on'));

                        return (
                          <tr key={row.id} className="align-top hover:bg-slate-50/70">
                            <td className="py-2 px-2.5 text-center font-mono-num text-slate-500 pt-2.5">
                              {idx + 1}
                            </td>
                            <td className="py-2 px-2.5">
                              <input
                                type="text"
                                disabled={isLockedRow}
                                value={row.chequeNumber}
                                onChange={(e) =>
                                  handleUpdateRow(row.id, {
                                    chequeNumber: e.target.value,
                                  })
                                }
                                className="w-24 px-2 py-1 text-xs font-mono-num font-semibold border border-slate-300 rounded bg-white disabled:bg-slate-100"
                              />
                            </td>
                            <td className="py-2 px-2.5">
                              <input
                                type="date"
                                disabled={isLockedRow}
                                value={row.originalDate}
                                onChange={(e) =>
                                  handleUpdateRow(row.id, {
                                    originalDate: e.target.value,
                                  })
                                }
                                className="px-2 py-1 text-xs font-mono-num border border-slate-300 rounded bg-white disabled:bg-slate-100"
                              />
                            </td>
                            <td className="py-2 px-2.5">
                              <div className="font-mono-num font-semibold text-slate-900 pt-1">
                                {formatIndianDate(row.effectiveDate)}
                              </div>
                              {wasShifted && row.shiftReason && (
                                <div className="mt-0.5 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                  {row.shiftReason}
                                </div>
                              )}
                              {isLeaveWarning && row.shiftReason && (
                                <div className="mt-0.5 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                                  {row.shiftReason}
                                </div>
                              )}
                              {isLockedRow && (
                                <div className="mt-0.5 text-[10px] font-semibold text-emerald-700">
                                  {row.status}
                                  {row.clearingBatchRef
                                    ? ` · ${row.clearingBatchRef}`
                                    : ''}
                                </div>
                              )}
                            </td>
                            <td className="py-2 px-2.5 text-right">
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                disabled={isLockedRow}
                                value={row.amount}
                                onChange={(e) =>
                                  handleUpdateRow(row.id, {
                                    amount: Number(e.target.value) || 0,
                                  })
                                }
                                className="w-28 px-2 py-1 text-xs font-mono-num text-right border border-slate-300 rounded bg-white disabled:bg-slate-100"
                              />
                            </td>
                            <td className="py-2 px-2 text-center pt-2">
                              {!isLockedRow && (
                                <button
                                  type="button"
                                  onClick={() => handleRemoveRow(row.id)}
                                  title="Remove cheque row"
                                  className="p-1 text-slate-400 hover:text-red-700 rounded hover:bg-red-50"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="px-3 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={handleAddManualRow}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-slate-800 hover:text-slate-950"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Cheque Row</span>
                  </button>
                  <span className="text-xs font-mono-num font-semibold text-slate-900">
                    Total: {formatINR(editorTotalAmount)}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Schedule Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., 12-month machinery loan PDC set handed over by borrower"
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {editingScheduleId ? 'Save Schedule Updates' : 'Save Cheque Schedule'}
                </span>
              </button>
            </div>
          </form>

          {/* Right Panel: Integrated Document & Cheque Scanner (STRICTLY ONLY HERE) */}
          <div className="xl:col-span-5">
            <ScheduleDocumentScanner
              documents={scannedDocs}
              onChangeDocuments={setScannedDocs}
            />
          </div>
        </div>
      </div>
    );
  }

  // Overview Mode: Daily Deposit Widget + Customer Schedules Directory
  return (
    <div className="space-y-6">
      {/* Top Action Header */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-[#0B192C] text-white flex items-center justify-center shrink-0">
            <CalendarCheck2 className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Customer Cheque Schedule (PDC / EMI Schedule)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Manage recurring PDC / EMI cheque sets with automatic Indian &amp; Tamil Nadu bank holiday shifting and daily deposit queues.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenBankHolidays}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Bank Holidays ({holidays.length})</span>
          </button>

          <button
            type="button"
            onClick={startNewSchedule}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Add Customer Schedule</span>
          </button>
        </div>
      </section>

      {/* Daily "Cheques to Deposit" Widget */}
      <DailyDepositScheduleWidget
        schedules={schedules}
        bankAccounts={bankAccounts}
        holidays={holidays}
        onSendToClearingBatch={onSendToClearingBatch}
      />

      {/* Saved Customer Schedules Directory */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">
              Customer PDC / EMI Schedules ({schedules.length})
            </h3>
            <p className="text-xs text-slate-500">
              Click any schedule to inspect individual installment dates, holiday shifts, and clearing batch status.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customer, loan ref, cheque #..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
            />
          </div>
        </div>

        {filteredSchedules.length === 0 ? (
          <div className="py-12 px-5 text-center space-y-3">
            <CalendarCheck2 className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-slate-800">
                {schedules.length === 0
                  ? 'No Customer PDC / EMI Schedules Created Yet'
                  : 'No schedules match your search'}
              </p>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Create a schedule to auto-generate recurring monthly/weekly PDC cheques, scan cheque leaves on the right side, and auto-shift bank holidays.
              </p>
            </div>
            {schedules.length === 0 && (
              <button
                type="button"
                onClick={startNewSchedule}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Schedule</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredSchedules.map((sch) => {
              const isExpanded = expandedScheduleId === sch.id;
              const totalVal = (sch.cheques || []).reduce(
                (s, c) => s + (c.amount || 0),
                0
              );
              const scheduledCnt = sch.cheques.filter(
                (c) => c.status === 'Scheduled'
              ).length;
              const inClearingCnt = sch.cheques.filter(
                (c) => c.status === 'In Clearing'
              ).length;
              const clearedCnt = sch.cheques.filter(
                (c) => c.status === 'Cleared'
              ).length;
              const firstThumb = sch.scannedDocuments?.find(
                (d) => d.thumbnailDataUrl
              );

              return (
                <div key={sch.id} className="bg-white">
                  <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/70 transition-colors">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedScheduleId((id) =>
                          id === sch.id ? null : sch.id
                        )
                      }
                      className="flex items-start gap-3 text-left flex-1 min-w-0"
                    >
                      <span className="mt-0.5 text-slate-400 shrink-0">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </span>
                      {firstThumb?.thumbnailDataUrl && (
                        <img
                          src={firstThumb.thumbnailDataUrl}
                          alt={firstThumb.fileName}
                          className="w-12 h-9 object-cover rounded border border-slate-200 shrink-0"
                        />
                      )}
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-slate-900">
                            {sch.customerName}
                          </span>
                          {sch.loanRefNo && (
                            <span className="text-xs font-mono-num text-slate-600">
                              · Ref: {sch.loanRefNo}
                            </span>
                          )}
                          {sch.holidayAutoShift && (
                            <span className="text-[10px] font-medium text-emerald-700">
                              · Holiday Auto-Shift ON
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <span>
                            {sch.draweeBank || 'Bank N/A'}
                            {sch.draweeBranch ? ` (${sch.draweeBranch})` : ''}
                          </span>
                          <span className="font-mono-num font-semibold text-slate-900">
                            {sch.cheques.length} Cheques · {formatINR(totalVal)}
                          </span>
                          <span className="font-mono-num text-slate-600">
                            {scheduledCnt} Scheduled · {inClearingCnt} In Clearing ·{' '}
                            {clearedCnt} Cleared
                          </span>
                          {sch.scannedDocuments.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-slate-700">
                              <FileImage className="w-3 h-3" />
                              <span>{sch.scannedDocuments.length} Scan(s)</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEditSchedule(sch)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Edit / Scan</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSchedule(sch.id)}
                        title="Delete Schedule"
                        className="p-1.5 text-slate-400 hover:text-red-700 rounded hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="px-5 pb-4 pt-1 bg-slate-50/50 border-t border-slate-100">
                      <div className="overflow-x-auto border border-slate-200 rounded-md bg-white">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] font-semibold text-slate-600">
                              <th className="py-2 px-3">#</th>
                              <th className="py-2 px-3">Cheque Number</th>
                              <th className="py-2 px-3">Original EMI Date</th>
                              <th className="py-2 px-3">Effective Deposit Date</th>
                              <th className="py-2 px-3 text-right">Amount (₹)</th>
                              <th className="py-2 px-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {sch.cheques.map((item, idx) => (
                              <tr key={item.id}>
                                <td className="py-2 px-3 font-mono-num text-slate-500">
                                  {idx + 1}
                                </td>
                                <td className="py-2 px-3 font-mono-num font-semibold text-slate-950">
                                  {item.chequeNumber}
                                </td>
                                <td className="py-2 px-3 font-mono-num text-slate-600">
                                  {formatIndianDate(item.originalDate)}
                                </td>
                                <td className="py-2 px-3">
                                  <span className="font-mono-num font-semibold text-slate-900">
                                    {formatIndianDate(item.effectiveDate)}
                                  </span>
                                  {item.shiftReason && (
                                    <span className="ml-2 text-[10px] font-medium text-amber-800">
                                      ({item.shiftReason})
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right font-mono-num font-semibold text-slate-950">
                                  {formatINR(item.amount)}
                                </td>
                                <td className="py-2 px-3">
                                  <span
                                    className={`font-semibold ${
                                      item.status === 'Cleared'
                                        ? 'text-emerald-700'
                                        : item.status === 'Returned / Bounced'
                                        ? 'text-red-700'
                                        : item.status === 'In Clearing'
                                        ? 'text-blue-700'
                                        : 'text-slate-700'
                                    }`}
                                  >
                                    {item.status}
                                    {item.clearingBatchRef
                                      ? ` (${item.clearingBatchRef})`
                                      : ''}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
