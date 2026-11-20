import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Edit3,
  FileImage,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { MAJOR_INDIAN_BANKS } from '../data/indianBanks';
import {
  BankHoliday,
  ChequeEntry,
  CompanyBankAccount,
  CompanyWorkspace,
  CustomerChequeSchedule,
  CustomerProfile,
  LoanInterestType,
  ScheduleFrequency,
  ScheduleScanDocument,
  ScheduledChequeItem,
} from '../types/treasury';
import {
  resolveEffectiveWorkingDate,
  toIsoDate,
} from '../utils/bankHolidays';
import {
  buildCustomerDirectory,
  getCustomerKey,
  resolveInstallmentPaidInfo,
} from '../utils/customerHelpers';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';
import {
  calculateLoanScheme,
  computeScheduleRowsWithBalance,
  generateLoanScheduleItems,
  getFrequencyLabel,
  getInterestTypeLabel,
  INTEREST_TYPE_OPTIONS,
  round2,
  SCHEDULE_FREQUENCY_OPTIONS,
} from '../utils/loanCalculator';
import { generateCustomerStatementPdf } from '../utils/pdfCustomerStatementGenerator';
import {
  DailyDepositScheduleWidget,
  SendToClearingSelection,
} from './DailyDepositScheduleWidget';
import { ScheduleDocumentScanner } from './ScheduleDocumentScanner';

interface CustomerScheduleViewProps {
  company?: CompanyWorkspace;
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
  company,
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

  // Customer & Loan particulars
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

  // Loan / Installment Scheme Calculator inputs
  const [frequency, setFrequency] = useState<ScheduleFrequency>('Monthly');
  const [customIntervalDays, setCustomIntervalDays] = useState('30');
  const [principalInput, setPrincipalInput] = useState('100000');
  const [numberOfDuesInput, setNumberOfDuesInput] = useState('12');
  const [interestRateInput, setInterestRateInput] = useState('12');
  const [interestType, setInterestType] = useState<LoanInterestType>('FLAT_PA');
  const [startDate, setStartDate] = useState(todayIso);
  const [startingChequeNo, setStartingChequeNo] = useState('001001');
  const [roundDueToNearestRupee, setRoundDueToNearestRupee] = useState(true);
  const [hasManualRowOverride, setHasManualRowOverride] = useState(false);
  const [overriddenChequeIndices, setOverriddenChequeIndices] = useState<
    number[]
  >([]);
  const [overriddenDateIndices, setOverriddenDateIndices] = useState<number[]>(
    []
  );

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

  const parsedPrincipal = Math.max(0, Number(principalInput) || 0);
  const parsedDues = Math.max(
    1,
    Math.min(120, Math.floor(Number(numberOfDuesInput) || 1))
  );
  const parsedRate = Math.max(0, Number(interestRateInput) || 0);
  const parsedCustomDays = Math.max(1, Math.floor(Number(customIntervalDays) || 30));

  // Live Scheme Summary (updates instantly as user types)
  const liveSchemeSummary = useMemo(
    () =>
      calculateLoanScheme({
        principalAmount: parsedPrincipal,
        numberOfDues: parsedDues,
        interestRate: parsedRate,
        interestType,
        frequency,
        customIntervalDays: parsedCustomDays,
        roundDueToNearestRupee,
      }),
    [
      parsedPrincipal,
      parsedDues,
      parsedRate,
      interestType,
      frequency,
      parsedCustomDays,
      roundDueToNearestRupee,
    ]
  );

  const rebuildScheduledRowsFromCalculator = (overrides?: {
    principalAmount?: number;
    numberOfDues?: number;
    interestRate?: number;
    interestType?: LoanInterestType;
    frequency?: ScheduleFrequency;
    customIntervalDays?: number;
    startDate?: string;
    startingChequeNumber?: string;
    roundDueToNearestRupee?: boolean;
    holidayAutoShift?: boolean;
    forceOverwrite?: boolean;
    preserveChequeOverrides?: number[];
    preserveDateOverrides?: number[];
  }) => {
    const nextPrincipal = overrides?.principalAmount ?? parsedPrincipal;
    const nextDues = overrides?.numberOfDues ?? parsedDues;
    const nextRate = overrides?.interestRate ?? parsedRate;
    const nextIntType = overrides?.interestType ?? interestType;
    const nextFreq = overrides?.frequency ?? frequency;
    const nextCustomDays = overrides?.customIntervalDays ?? parsedCustomDays;
    const nextStart = overrides?.startDate ?? startDate;
    const nextChqStart = overrides?.startingChequeNumber ?? startingChequeNo;
    const nextRound =
      overrides?.roundDueToNearestRupee ?? roundDueToNearestRupee;
    const nextShift = overrides?.holidayAutoShift ?? holidayAutoShift;

    const lockedRows = rows.filter((r) => r.status !== 'Scheduled');
    const remainingDues = Math.max(0, nextDues - lockedRows.length);

    if (remainingDues === 0) {
      setRows(lockedRows);
      if (overrides?.forceOverwrite) {
        setHasManualRowOverride(false);
        setOverriddenChequeIndices([]);
        setOverriddenDateIndices([]);
      }
      return;
    }

    const lockedPrincipal = lockedRows.reduce(
      (s, r) => s + (r.principalAmount ?? r.amount ?? 0),
      0
    );
    const remainingPrincipal =
      lockedRows.length > 0
        ? Math.max(0, round2(nextPrincipal - lockedPrincipal))
        : nextPrincipal;

    const summary = calculateLoanScheme({
      principalAmount: remainingPrincipal,
      numberOfDues: remainingDues,
      interestRate: nextRate,
      interestType: nextIntType,
      frequency: nextFreq,
      customIntervalDays: nextCustomDays,
      roundDueToNearestRupee: nextRound,
    });

    const chequeOverrideSet = new Set(
      overrides?.forceOverwrite
        ? []
        : overrides?.preserveChequeOverrides ?? overriddenChequeIndices
    );
    const dateOverrideSet = new Set(
      overrides?.forceOverwrite
        ? []
        : overrides?.preserveDateOverrides ?? overriddenDateIndices
    );

    const generated = generateLoanScheduleItems({
      startDate: nextStart || todayIso,
      frequency: nextFreq,
      customIntervalDays: nextCustomDays,
      startingChequeNumber: nextChqStart || '001001',
      holidayAutoShift: nextShift,
      holidays,
      summary,
      dueStartOffset: lockedRows.length,
    }).map((item, idx) => {
      const globalIdx = lockedRows.length + idx;
      const existingRow = rows[globalIdx];
      let nextItem = item;

      if (existingRow && chequeOverrideSet.has(globalIdx)) {
        nextItem = { ...nextItem, chequeNumber: existingRow.chequeNumber };
      }
      if (existingRow && dateOverrideSet.has(globalIdx)) {
        const resolved = resolveEffectiveWorkingDate(
          existingRow.originalDate,
          nextShift,
          holidays
        );
        nextItem = {
          ...nextItem,
          originalDate: existingRow.originalDate,
          effectiveDate: resolved.effectiveDate,
          shiftReason: resolved.shiftReason || resolved.leaveWarning,
        };
      }
      return nextItem;
    });

    setRows([...lockedRows, ...generated]);
    if (overrides?.forceOverwrite) {
      setHasManualRowOverride(false);
      setOverriddenChequeIndices([]);
      setOverriddenDateIndices([]);
    }
  };

  const handleCalculatorParamChange = (patch: {
    principalInput?: string;
    numberOfDuesInput?: string;
    interestRateInput?: string;
    interestType?: LoanInterestType;
    frequency?: ScheduleFrequency;
    customIntervalDays?: string;
    startDate?: string;
    startingChequeNo?: string;
    roundDueToNearestRupee?: boolean;
  }) => {
    const nextP =
      patch.principalInput !== undefined ? patch.principalInput : principalInput;
    const nextN =
      patch.numberOfDuesInput !== undefined
        ? patch.numberOfDuesInput
        : numberOfDuesInput;
    const nextR =
      patch.interestRateInput !== undefined
        ? patch.interestRateInput
        : interestRateInput;
    const nextIT = patch.interestType ?? interestType;
    const nextFreq = patch.frequency ?? frequency;
    const nextCDays = patch.customIntervalDays ?? customIntervalDays;
    const nextStart = patch.startDate ?? startDate;
    const nextChq = patch.startingChequeNo ?? startingChequeNo;
    const nextRound =
      patch.roundDueToNearestRupee ?? roundDueToNearestRupee;

    let nextChequeOverrides = overriddenChequeIndices;
    let nextDateOverrides = overriddenDateIndices;

    if (patch.startingChequeNo !== undefined) {
      nextChequeOverrides = [];
      setOverriddenChequeIndices([]);
    }
    if (patch.startDate !== undefined || patch.frequency !== undefined) {
      nextDateOverrides = [];
      setOverriddenDateIndices([]);
    }

    if (patch.principalInput !== undefined) setPrincipalInput(nextP);
    if (patch.numberOfDuesInput !== undefined) setNumberOfDuesInput(nextN);
    if (patch.interestRateInput !== undefined) setInterestRateInput(nextR);
    if (patch.interestType !== undefined) setInterestType(nextIT);
    if (patch.frequency !== undefined) setFrequency(nextFreq);
    if (patch.customIntervalDays !== undefined) setCustomIntervalDays(nextCDays);
    if (patch.startDate !== undefined) setStartDate(nextStart);
    if (patch.startingChequeNo !== undefined) setStartingChequeNo(nextChq);
    if (patch.roundDueToNearestRupee !== undefined)
      setRoundDueToNearestRupee(nextRound);

    if (scheduleMode === 'auto' && !hasManualRowOverride) {
      const validStart = /^\d{4}-\d{2}-\d{2}$/.test(nextStart)
        ? nextStart
        : todayIso;
      rebuildScheduledRowsFromCalculator({
        principalAmount: Math.max(0, Number(nextP) || 0),
        numberOfDues: Math.max(1, Math.min(120, Math.floor(Number(nextN) || 1))),
        interestRate: Math.max(0, Number(nextR) || 0),
        interestType: nextIT,
        frequency: nextFreq,
        customIntervalDays: Math.max(1, Math.floor(Number(nextCDays) || 30)),
        startDate: validStart,
        startingChequeNumber: nextChq,
        roundDueToNearestRupee: nextRound,
        preserveChequeOverrides: nextChequeOverrides,
        preserveDateOverrides: nextDateOverrides,
      });
    }
  };

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
    setFrequency('Monthly');
    setCustomIntervalDays('30');
    setPrincipalInput('100000');
    setNumberOfDuesInput('12');
    setInterestRateInput('12');
    setInterestType('FLAT_PA');
    setStartDate(todayIso);
    setStartingChequeNo('001001');
    setRoundDueToNearestRupee(true);
    setHasManualRowOverride(false);
    setOverriddenChequeIndices([]);
    setOverriddenDateIndices([]);
    setScannedDocs([]);
    setNotes('');
    setFormError(null);

    const initialSummary = calculateLoanScheme({
      principalAmount: 100000,
      numberOfDues: 12,
      interestRate: 12,
      interestType: 'FLAT_PA',
      frequency: 'Monthly',
      roundDueToNearestRupee: true,
    });
    const initialRows = generateLoanScheduleItems({
      startDate: todayIso,
      frequency: 'Monthly',
      startingChequeNumber: '001001',
      holidayAutoShift: true,
      holidays,
      summary: initialSummary,
    });
    setRows(initialRows);
    setViewMode('editor');
  };

  const startEditSchedule = (sch: CustomerChequeSchedule) => {
    const fallbackTotal = (sch.cheques || []).reduce(
      (s, c) => s + (c.amount || 0),
      0
    );
    const derivedPrincipal =
      sch.principalAmount !== undefined ? sch.principalAmount : fallbackTotal;
    const derivedDues =
      sch.numberOfDues !== undefined
        ? sch.numberOfDues
        : Math.max(1, sch.cheques.length);
    const derivedRate = sch.interestRate !== undefined ? sch.interestRate : 0;
    const derivedInterestType: LoanInterestType =
      sch.interestType || (derivedRate === 0 ? 'ZERO_INTEREST' : 'FLAT_PA');
    const derivedFreq: ScheduleFrequency = sch.frequency || 'Monthly';
    const derivedRound = sch.roundDueToNearestRupee ?? true;
    const derivedStart =
      sch.startDate || sch.cheques[0]?.originalDate || todayIso;
    const derivedChqStart =
      sch.startingChequeNumber || sch.cheques[0]?.chequeNumber || '001001';

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
    setStartDate(derivedStart);
    setFrequency(derivedFreq);
    setCustomIntervalDays(String(sch.customIntervalDays || 30));
    setPrincipalInput(String(derivedPrincipal));
    setNumberOfDuesInput(String(derivedDues));
    setInterestRateInput(String(derivedRate));
    setInterestType(derivedInterestType);
    setStartingChequeNo(derivedChqStart);
    setRoundDueToNearestRupee(derivedRound);

    if (sch.mode === 'auto') {
      const expectedSummary = calculateLoanScheme({
        principalAmount: derivedPrincipal,
        numberOfDues: derivedDues,
        interestRate: derivedRate,
        interestType: derivedInterestType,
        frequency: derivedFreq,
        customIntervalDays: sch.customIntervalDays || 30,
        roundDueToNearestRupee: derivedRound,
      });
      const expectedRows = generateLoanScheduleItems({
        startDate: derivedStart,
        frequency: derivedFreq,
        customIntervalDays: sch.customIntervalDays || 30,
        startingChequeNumber: derivedChqStart,
        holidayAutoShift: sch.holidayAutoShift,
        holidays,
        summary: expectedSummary,
      });

      const amountsDiffer =
        expectedRows.length !== sch.cheques.length ||
        sch.cheques.some(
          (row, idx) => Math.abs(row.amount - expectedRows[idx].amount) > 0.05
        );
      const customCheques: number[] = [];
      const customDates: number[] = [];
      sch.cheques.forEach((row, idx) => {
        const exp = expectedRows[idx];
        if (!exp) return;
        if (row.chequeNumber !== exp.chequeNumber) customCheques.push(idx);
        if (row.originalDate !== exp.originalDate) customDates.push(idx);
      });
      setHasManualRowOverride(amountsDiffer);
      setOverriddenChequeIndices(customCheques);
      setOverriddenDateIndices(customDates);
    } else {
      setHasManualRowOverride(true);
      setOverriddenChequeIndices([]);
      setOverriddenDateIndices([]);
    }

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
      : startingChequeNo || '001001';
    const resolved = resolveEffectiveWorkingDate(
      nextDate,
      holidayAutoShift,
      holidays
    );
    const defaultAmt =
      lastRow?.amount ?? (liveSchemeSummary.autoDueAmount || 25000);
    setHasManualRowOverride(true);
    setRows((prev) => [
      ...prev,
      {
        id: `sch-chq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        dueNumber: prev.length + 1,
        chequeNumber: nextChqNo,
        originalDate: nextDate,
        effectiveDate: resolved.effectiveDate,
        shiftReason: resolved.shiftReason || resolved.leaveWarning,
        principalAmount: defaultAmt,
        interestAmount: 0,
        amount: defaultAmt,
        status: 'Scheduled',
      },
    ]);
  };

  const handleUpdateRow = (
    rowId: string,
    patch: Partial<{ chequeNumber: string; originalDate: string; amount: number }>
  ) => {
    const targetIdx = rows.findIndex((r) => r.id === rowId);
    if (patch.chequeNumber !== undefined && targetIdx >= 0) {
      setOverriddenChequeIndices((prev) =>
        prev.includes(targetIdx) ? prev : [...prev, targetIdx]
      );
    }
    if (patch.originalDate !== undefined && targetIdx >= 0) {
      setOverriddenDateIndices((prev) =>
        prev.includes(targetIdx) ? prev : [...prev, targetIdx]
      );
    }
    if (patch.amount !== undefined) {
      setHasManualRowOverride(true);
    }

    setRows((prev) =>
      prev.map((item) => {
        if (item.id !== rowId) return item;
        const nextOriginal = patch.originalDate ?? item.originalDate;
        const resolved =
          item.status === 'Scheduled'
            ? resolveEffectiveWorkingDate(nextOriginal, holidayAutoShift, holidays)
            : null;
        let nextPrincipal = item.principalAmount;
        let nextInterest = item.interestAmount;
        if (patch.amount !== undefined && nextPrincipal !== undefined) {
          const interestPortion = item.interestAmount ?? 0;
          if (patch.amount >= interestPortion) {
            nextPrincipal = round2(patch.amount - interestPortion);
          } else {
            nextPrincipal = round2(patch.amount);
            nextInterest = 0;
          }
        }
        return {
          ...item,
          ...patch,
          principalAmount: nextPrincipal,
          interestAmount: nextInterest,
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
    setHasManualRowOverride(true);
    setRows((prev) =>
      prev
        .filter((r) => r.id !== rowId)
        .map((r, idx) => ({ ...r, dueNumber: idx + 1 }))
    );
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

    const totalPrincipalRows = round2(
      rows.reduce((s, r) => s + (r.principalAmount ?? r.amount ?? 0), 0)
    );
    const totalInterestRows = round2(
      rows.reduce((s, r) => s + (r.interestAmount ?? 0), 0)
    );
    const totalAmountRows = round2(
      rows.reduce((s, r) => s + (r.amount || 0), 0)
    );

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
            ? parsedCustomDays
            : undefined,
        startDate: scheduleMode === 'auto' ? startDate : undefined,
        startingChequeNumber:
          scheduleMode === 'auto' ? startingChequeNo.trim() : undefined,
        principalAmount:
          scheduleMode === 'auto' ? parsedPrincipal : totalPrincipalRows,
        numberOfDues: rows.length,
        interestRate: scheduleMode === 'auto' ? parsedRate : 0,
        interestType: scheduleMode === 'auto' ? interestType : 'ZERO_INTEREST',
        roundDueToNearestRupee:
          scheduleMode === 'auto' ? roundDueToNearestRupee : false,
        totalInterest:
          scheduleMode === 'auto' ? totalInterestRows : totalInterestRows,
        totalPayable: totalAmountRows,
        autoDueAmount:
          scheduleMode === 'auto' ? liveSchemeSummary.autoDueAmount : undefined,
        cheques: rows.map((r, idx) => ({ ...r, dueNumber: idx + 1 })),
        scannedDocuments: scannedDocs,
        notes: notes.trim() || undefined,
      },
      editingScheduleId || undefined
    );

    setViewMode('overview');
    setEditingScheduleId(null);
  };

  const chequeById = useMemo(
    () => new Map(cheques.map((c) => [c.id, c])),
    [cheques]
  );

  const handleDownloadCustomerPdfFromSchedule = (sch: CustomerChequeSchedule) => {
    const workspace: CompanyWorkspace = company || {
      id: 'active',
      profile: {
        companyName: 'Corporate Treasury',
        registeredAddress: '',
        pan: '',
        gstin: '',
        contactPhone: '',
        treasuryEmail: '',
        defaultMaker: 'Maker',
        defaultChecker: 'Checker',
        signatory1Name: '',
        signatory1Designation: '',
        signatory2Name: '',
        signatory2Designation: '',
      },
      bankAccounts,
      batches: [],
      cheques,
      activeBatchId: '',
      customers,
      chequeSchedules: schedules,
      bankHolidays: holidays,
    };

    const directory = buildCustomerDirectory(workspace);
    const targetKey = getCustomerKey(sch.customerCode, sch.customerName);
    const normalizedName = sch.customerName.trim().toLowerCase();
    const matched =
      directory.find((c) => c.customerKey === targetKey) ||
      directory.find(
        (c) => c.profile.partyName.trim().toLowerCase() === normalizedName
      ) ||
      directory.find((c) => c.schedules.some((s) => s.id === sch.id));

    if (matched) {
      generateCustomerStatementPdf(workspace, matched);
    }
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
    const editorTotalAmount = round2(
      rows.reduce((s, r) => s + (r.amount || 0), 0)
    );
    const editorTotalPrincipal = round2(
      rows.reduce((s, r) => s + (r.principalAmount ?? r.amount ?? 0), 0)
    );
    const editorTotalInterest = round2(
      rows.reduce((s, r) => s + (r.interestAmount ?? 0), 0)
    );
    const shiftedRowsCount = rows.filter(
      (r) => r.effectiveDate !== r.originalDate
    ).length;
    const hasTableCalcDiff =
      scheduleMode === 'auto' &&
      Math.abs(editorTotalAmount - liveSchemeSummary.totalPayable) > 0.05;

    return (
      <div className="space-y-5">
        {/* Top Editor Header */}
        <div className="bg-white border border-[#D9E2EC] rounded-lg px-5 py-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setViewMode('overview')}
              className="p-1.5 text-[#243B53] hover:text-[#102A43] bg-[#F4F7FA] hover:bg-[#D9E2EC]/60 border border-[#D9E2EC] rounded-md transition-colors"
              title="Back to Customer Schedules"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-base font-semibold text-[#102A43]">
                {editingScheduleId
                  ? 'Edit Customer PDC / Loan Scheme Schedule'
                  : 'New Customer PDC / Loan Scheme Schedule'}
              </h2>
              <p className="text-xs text-[#627D98]">
                Compute EMI &amp; repayment dates on the left while inspecting scanned PDC leaves on the right.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onOpenBankHolidays}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] whitespace-nowrap transition-colors"
            >
              <CalendarDays className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
              <span>Bank Holidays ({holidays.length})</span>
            </button>
          </div>
        </div>

        {/* Split-Screen: Left Panel (Scheme Calculator & Schedule Form) + Right Panel (Sticky Document Scanner) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          {/* Left Panel: Customer, Loan Scheme Calculator & Auto-Generated Table */}
          <form
            onSubmit={handleSubmitSchedule}
            className="xl:col-span-7 bg-white border border-[#D9E2EC] rounded-lg p-5 space-y-5 shadow-xs"
          >
            {formError && (
              <div className="p-3 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-md text-xs text-[#DC2626] flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* 1. Customer & Loan Particulars */}
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#D9E2EC] pb-2.5">
                <h3 className="text-sm font-semibold text-[#102A43]">
                  1. Customer &amp; Loan Particulars
                </h3>
                <span className="text-[11px] font-mono-num text-[#627D98]">
                  {rows.length} Dues · {formatINR(editorTotalAmount)}
                </span>
              </div>

              {partyDirectory.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
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
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
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
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Customer / Party Name <span className="text-[#DC2626]">*</span>
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
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Loan / Scheme Ref No
                  </label>
                  <input
                    type="text"
                    value={loanRefNo}
                    onChange={(e) => setLoanRefNo(e.target.value)}
                    placeholder="e.g., LN/2026/EMI-409"
                    className="w-full px-3 py-2 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Drawee Bank Name
                  </label>
                  <input
                    type="text"
                    list="pdc-bank-presets"
                    value={draweeBank}
                    onChange={(e) => setDraweeBank(e.target.value)}
                    placeholder="e.g., Indian Overseas Bank"
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                  <datalist id="pdc-bank-presets">
                    {MAJOR_INDIAN_BANKS.map((b) => (
                      <option key={b.shortCode} value={b.name} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Drawee Branch Name
                  </label>
                  <input
                    type="text"
                    value={draweeBranch}
                    onChange={(e) => setDraweeBranch(e.target.value)}
                    placeholder="e.g., Ashok Nagar, Chennai"
                    className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Deposit Account (Company)
                  </label>
                  <select
                    value={companyBankAccountId}
                    onChange={(e) => setCompanyBankAccountId(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
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

            {/* 2. Loan / Installment Scheme Calculator */}
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#D9E2EC] pb-2.5">
                <div className="flex items-center gap-2">
                  <Calculator className="w-4 h-4 text-[#176B87]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold text-[#102A43]">
                    2. Loan / Installment Scheme Calculator
                  </h3>
                </div>
                <div className="inline-flex p-0.5 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md">
                  <button
                    type="button"
                    onClick={() => {
                      setScheduleMode('auto');
                      rebuildScheduledRowsFromCalculator({
                        forceOverwrite: true,
                      });
                    }}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      scheduleMode === 'auto'
                        ? 'bg-white text-[#102A43] font-semibold shadow-xs'
                        : 'text-[#627D98] hover:text-[#102A43]'
                    }`}
                  >
                    Scheme Calculator (Auto)
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleMode('manual')}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      scheduleMode === 'manual'
                        ? 'bg-white text-[#102A43] font-semibold shadow-xs'
                        : 'text-[#627D98] hover:text-[#102A43]'
                    }`}
                  >
                    Manual Multi-Cheque Rows
                  </button>
                </div>
              </div>

              {scheduleMode === 'auto' && (
                <div className="space-y-4">
                  {/* Calculator Inputs */}
                  <div className="p-4 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md space-y-4">
                    {/* Frequency Mode Radio Pills */}
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-1.5">
                        <label className="block text-[11px] font-semibold text-[#243B53]">
                          Schedule Frequency Mode
                        </label>
                        <span className="text-[11px] font-mono-num text-[#627D98]">
                          {liveSchemeSummary.tenureMonths.toFixed(1)} months ·{' '}
                          {liveSchemeSummary.tenureYears.toFixed(2)} yrs
                        </span>
                      </div>
                      <div
                        role="radiogroup"
                        aria-label="Schedule Frequency Mode"
                        className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
                      >
                        {SCHEDULE_FREQUENCY_OPTIONS.map((opt) => {
                          const isSelected = frequency === opt.value;
                          return (
                            <button
                              key={opt.value}
                              type="button"
                              role="radio"
                              aria-checked={isSelected}
                              onClick={() =>
                                handleCalculatorParamChange({
                                  frequency: opt.value,
                                })
                              }
                              className={`px-2.5 py-2 text-left rounded-md border transition-colors ${
                                isSelected
                                  ? 'bg-[#102A43] text-white border-[#14B8A6] ring-1 ring-[#14B8A6]/30'
                                  : 'bg-white text-[#243B53] border-[#D9E2EC] hover:bg-[#F4F7FA]'
                              }`}
                            >
                              <div className="text-xs font-semibold truncate">
                                {opt.shortLabel}
                              </div>
                              <div
                                className={`text-[10px] font-mono-num mt-0.5 ${
                                  isSelected ? 'text-[#14B8A6]' : 'text-[#627D98]'
                                }`}
                              >
                                {opt.intervalHint}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Financial Inputs Grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                          Loan / Principal Amount (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={principalInput}
                          onChange={(e) =>
                            handleCalculatorParamChange({
                              principalInput: e.target.value,
                            })
                          }
                          placeholder="100000"
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                          Number of Dues (N)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={120}
                          value={numberOfDuesInput}
                          onChange={(e) =>
                            handleCalculatorParamChange({
                              numberOfDuesInput: e.target.value,
                            })
                          }
                          placeholder="12"
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                          Interest Rate (%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={interestType === 'ZERO_INTEREST'}
                          value={
                            interestType === 'ZERO_INTEREST'
                              ? '0'
                              : interestRateInput
                          }
                          onChange={(e) =>
                            handleCalculatorParamChange({
                              interestRateInput: e.target.value,
                            })
                          }
                          placeholder="12"
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                    </div>

                    {/* Interest Type + First Due Date + Starting Cheque No */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                          Interest Type
                        </label>
                        <select
                          value={interestType}
                          onChange={(e) =>
                            handleCalculatorParamChange({
                              interestType: e.target.value as LoanInterestType,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        >
                          {INTEREST_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                          First Due Date
                        </label>
                        <input
                          type="date"
                          value={startDate}
                          onChange={(e) =>
                            handleCalculatorParamChange({
                              startDate: e.target.value,
                            })
                          }
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                          Starting Cheque Number
                        </label>
                        <input
                          type="text"
                          value={startingChequeNo}
                          onChange={(e) =>
                            handleCalculatorParamChange({
                              startingChequeNo: e.target.value,
                            })
                          }
                          placeholder="001001"
                          className="w-full px-2.5 py-1.5 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                    </div>

                    {/* Rounding Option + Apply/Regenerate Action */}
                    <div className="pt-1 flex flex-wrap items-center justify-between gap-3 border-t border-[#D9E2EC]">
                      <label className="inline-flex items-center gap-2 cursor-pointer text-xs text-[#243B53]">
                        <input
                          type="checkbox"
                          checked={roundDueToNearestRupee}
                          onChange={(e) =>
                            handleCalculatorParamChange({
                              roundDueToNearestRupee: e.target.checked,
                            })
                          }
                          className="rounded border-[#D9E2EC] text-[#14B8A6] focus:ring-[#14B8A6]"
                        />
                        <span>
                          Round Due Amount to nearest ₹1 (auto-adjust final due to match exact Total Payable)
                        </span>
                      </label>

                      <button
                        type="button"
                        onClick={() =>
                          rebuildScheduledRowsFromCalculator({
                            forceOverwrite: true,
                          })
                        }
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#176B87] rounded-md hover:bg-[#102A43] transition-colors whitespace-nowrap shrink-0"
                      >
                        {hasManualRowOverride ? (
                          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                        ) : (
                          <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        )}
                        <span>
                          {hasManualRowOverride
                            ? 'Apply Calculator to Table'
                            : 'Regenerate Schedule Rows'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Live Scheme Summary Box (Updates Instantly as User Types) */}
                  <div
                    aria-label="Live Scheme Summary"
                    className="border border-[#D9E2EC] rounded-lg overflow-hidden bg-white"
                  >
                    <div className="grid grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[#D9E2EC]">
                      <div className="p-3.5">
                        <div className="text-[11px] font-medium text-[#627D98]">
                          Loan Principal
                        </div>
                        <div className="mt-1 text-base font-bold text-[#102A43] font-mono-num">
                          {formatINR(liveSchemeSummary.principalAmount)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#627D98] font-mono-num">
                          {liveSchemeSummary.numberOfDues} dues ·{' '}
                          {getFrequencyLabel(liveSchemeSummary.frequency)}
                        </div>
                      </div>

                      <div className="p-3.5">
                        <div className="text-[11px] font-medium text-[#627D98]">
                          Total Interest
                        </div>
                        <div className="mt-1 text-base font-bold text-[#102A43] font-mono-num">
                          {formatINR(liveSchemeSummary.totalInterest)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#627D98]">
                          {getInterestTypeLabel(liveSchemeSummary.interestType)}
                          {liveSchemeSummary.interestType !== 'ZERO_INTEREST'
                            ? ` (${liveSchemeSummary.interestRate}%)`
                            : ''}
                        </div>
                      </div>

                      <div className="p-3.5">
                        <div className="text-[11px] font-medium text-[#627D98]">
                          Total Payable
                        </div>
                        <div className="mt-1 text-base font-bold text-[#102A43] font-mono-num">
                          {formatINR(liveSchemeSummary.totalPayable)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#627D98]">
                          Principal + Interest
                        </div>
                      </div>

                      <div className="p-3.5 bg-[#102A43] text-white">
                        <div className="text-[11px] font-medium text-[#D9E2EC]">
                          Auto Due Amount (Per Installment)
                        </div>
                        <div className="mt-1 text-lg font-bold tracking-tight font-mono-num text-[#14B8A6]">
                          {formatINR(liveSchemeSummary.autoDueAmount)}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#D9E2EC] font-mono-num">
                          {liveSchemeSummary.hasFinalRoundingAdjustment
                            ? `Final due #${liveSchemeSummary.numberOfDues}: ${formatINR(liveSchemeSummary.finalDueAmount)}`
                            : `Exact ${formatINR(liveSchemeSummary.exactDueAmount)} / due`}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Holiday Auto-Shift Toggle */}
              <div className="p-3 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <div className="text-xs font-semibold text-[#102A43]">
                    Bank Holiday Calendar Auto-Shift
                  </div>
                  <p className="text-[11px] text-[#627D98] mt-0.5">
                    Shifts Sundays, 2nd/4th Saturdays &amp; Bank Holidays to the next working bank day.
                    {shiftedRowsCount > 0 && (
                      <span className="ml-1.5 font-semibold text-[#B45309] font-mono-num">
                        · {shiftedRowsCount} due{shiftedRowsCount === 1 ? '' : 's'} shifted
                      </span>
                    )}
                  </p>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={holidayAutoShift}
                    onChange={(e) => handleToggleHolidayAutoShift(e.target.checked)}
                    className="rounded border-[#D9E2EC] text-[#14B8A6] focus:ring-[#14B8A6]"
                  />
                  <span className="text-xs font-semibold text-[#102A43] whitespace-nowrap">
                    {holidayAutoShift ? 'Auto-Shift ON' : 'Auto-Shift OFF'}
                  </span>
                </label>
              </div>

              {hasManualRowOverride && hasTableCalcDiff && (
                <div className="px-3.5 py-2 bg-[#F59E0B]/10 border border-[#F59E0B]/40 rounded-md text-xs text-[#243B53] flex flex-wrap items-center justify-between gap-2">
                  <span>
                    Table rows ({formatINR(editorTotalAmount)}) differ from current Scheme Total Payable ({formatINR(liveSchemeSummary.totalPayable)}).
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      rebuildScheduledRowsFromCalculator({ forceOverwrite: true })
                    }
                    className="text-xs font-semibold text-[#B45309] underline hover:text-[#102A43] whitespace-nowrap"
                  >
                    Sync Table to Calculator
                  </button>
                </div>
              )}

              {/* Auto-Generated Schedule Table (1 to N Dues) */}
              <div className="border border-[#D9E2EC] rounded-md overflow-hidden bg-white">
                <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-[#F4F7FA] z-10 border-b border-[#D9E2EC] text-[11px] font-semibold text-[#627D98]">
                      <tr>
                        <th className="py-2 px-2 text-center whitespace-nowrap">
                          Inst. #
                        </th>
                        <th className="py-2 px-2 whitespace-nowrap">
                          Due Date
                        </th>
                        <th className="py-2 px-2 whitespace-nowrap">
                          Effective Bank Deposit Date (Holiday-Adjusted)
                        </th>
                        <th className="py-2 px-2 whitespace-nowrap">
                          Cheque No
                        </th>
                        <th className="py-2 px-2 text-right whitespace-nowrap">
                          Principal (₹)
                        </th>
                        <th className="py-2 px-2 text-right whitespace-nowrap">
                          Interest (₹)
                        </th>
                        <th className="py-2 px-2 text-right whitespace-nowrap">
                          Due Amount (₹)
                        </th>
                        <th className="py-2 px-2 whitespace-nowrap">
                          Paid Status
                        </th>
                        <th className="py-2 px-2 text-right whitespace-nowrap">
                          Balance (₹)
                        </th>
                        <th className="py-2 px-1.5 w-8" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#D9E2EC] text-xs">
                      {computeScheduleRowsWithBalance(rows).map(
                        ({ item: row, runningBalance }, idx) => {
                          const isLockedRow = row.status !== 'Scheduled';
                          const wasShifted =
                            row.effectiveDate !== row.originalDate;
                          const isLeaveWarning =
                            !wasShifted &&
                            Boolean(row.shiftReason?.startsWith('Falls on'));
                          const rowPrincipal =
                            row.principalAmount !== undefined
                              ? row.principalAmount
                              : row.amount;
                          const rowInterest =
                            row.interestAmount !== undefined
                              ? row.interestAmount
                              : 0;
                          const paidInfo = resolveInstallmentPaidInfo(
                            row,
                            chequeById
                          );

                          return (
                            <tr
                              key={row.id}
                              className="align-top hover:bg-[#F4F7FA]/80"
                            >
                              <td className="py-2 px-2 text-center font-mono-num text-[#627D98] pt-2.5">
                                {row.dueNumber ?? idx + 1}
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="date"
                                  disabled={isLockedRow}
                                  value={row.originalDate}
                                  onChange={(e) =>
                                    handleUpdateRow(row.id, {
                                      originalDate: e.target.value,
                                    })
                                  }
                                  className="px-2 py-1 text-xs font-mono-num border border-[#D9E2EC] rounded bg-white text-[#243B53] disabled:bg-[#F4F7FA] disabled:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                                />
                              </td>
                              <td className="py-2 px-2 min-w-[140px]">
                                <div className="font-mono-num font-semibold text-[#102A43] pt-0.5 whitespace-nowrap">
                                  {formatIndianDate(row.effectiveDate)}
                                </div>
                                {wasShifted && (
                                  <div className="mt-0.5 space-y-0.5">
                                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F59E0B]/10 text-[#B45309] border border-[#F59E0B]/30 whitespace-nowrap">
                                      Shifted (Holiday)
                                    </span>
                                    {row.shiftReason && (
                                      <div className="text-[10px] text-[#B45309]">
                                        {row.shiftReason}
                                      </div>
                                    )}
                                  </div>
                                )}
                                {isLeaveWarning && row.shiftReason && (
                                  <div className="mt-0.5 inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#DC2626]/10 text-[#DC2626] border border-[#DC2626]/30">
                                    {row.shiftReason}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2">
                                <input
                                  type="text"
                                  disabled={isLockedRow}
                                  value={row.chequeNumber}
                                  onChange={(e) =>
                                    handleUpdateRow(row.id, {
                                      chequeNumber: e.target.value,
                                    })
                                  }
                                  className="w-24 px-2 py-1 text-xs font-mono-num font-semibold border border-[#D9E2EC] rounded bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                                />
                              </td>
                              <td className="py-2 px-2 text-right font-mono-num text-[#243B53] pt-2.5 whitespace-nowrap">
                                {formatINR(rowPrincipal)}
                              </td>
                              <td className="py-2 px-2 text-right font-mono-num text-[#627D98] pt-2.5 whitespace-nowrap">
                                {formatINR(rowInterest)}
                              </td>
                              <td className="py-2 px-2 text-right">
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
                                  className="w-24 px-2 py-1 text-xs font-mono-num font-semibold text-right border border-[#D9E2EC] rounded bg-white text-[#102A43] disabled:bg-[#F4F7FA] disabled:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                                />
                              </td>
                              <td className="py-2 px-2 pt-2.5 whitespace-nowrap">
                                <span
                                  className={`text-[11px] font-semibold ${
                                    paidInfo.isPaid
                                      ? 'text-[#16A34A]'
                                      : paidInfo.effectiveStatus ===
                                        'Returned / Bounced'
                                      ? 'text-[#DC2626]'
                                      : paidInfo.effectiveStatus ===
                                        'In Clearing'
                                      ? 'text-[#2563EB]'
                                      : 'text-[#64748B]'
                                  }`}
                                >
                                  {paidInfo.paidLabel}
                                </span>
                                {row.clearingBatchRef && (
                                  <div className="text-[10px] font-mono-num text-[#627D98]">
                                    {row.clearingBatchRef}
                                  </div>
                                )}
                              </td>
                              <td className="py-2 px-2 text-right font-mono-num font-semibold text-[#102A43] pt-2.5 whitespace-nowrap">
                                {formatINR(runningBalance)}
                              </td>
                              <td className="py-2 px-1.5 text-center pt-2">
                                {!isLockedRow && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveRow(row.id)}
                                    title="Remove cheque row"
                                    className="p-1 text-[#627D98] hover:text-[#DC2626] rounded hover:bg-[#DC2626]/10"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        }
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="px-3 py-2.5 bg-[#F4F7FA] border-t border-[#D9E2EC] flex flex-wrap items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={handleAddManualRow}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#176B87] hover:text-[#102A43] whitespace-nowrap"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add Cheque Row</span>
                  </button>
                  <div className="flex flex-wrap items-center gap-3 font-mono-num text-[#627D98]">
                    <span>
                      Principal:{' '}
                      <strong className="text-[#102A43]">
                        {formatINR(editorTotalPrincipal)}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Interest:{' '}
                      <strong className="text-[#102A43]">
                        {formatINR(editorTotalInterest)}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Total Payable:{' '}
                      <strong className="text-[#102A43]">
                        {formatINR(editorTotalAmount)}
                      </strong>
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1">
                Schedule Notes (Optional)
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g., 12-month machinery loan PDC set handed over by borrower"
                className="w-full px-3 py-2 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#D9E2EC]">
              <button
                type="button"
                onClick={() => setViewMode('overview')}
                className="px-4 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] transition-colors"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>
                  {editingScheduleId ? 'Save Schedule Updates' : 'Save Cheque Schedule'}
                </span>
              </button>
            </div>
          </form>

          {/* Right Panel: Sticky Integrated Document & Cheque Scanner */}
          <div className="xl:col-span-5 xl:sticky xl:top-6">
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
      <section className="bg-white border border-[#D9E2EC] rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-[#102A43] text-[#14B8A6] flex items-center justify-center shrink-0">
            <CalendarCheck2 className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#102A43]">
              Customer Cheque Schedule (Loan Scheme &amp; PDC Calculator)
            </h2>
            <p className="text-xs text-[#627D98] mt-0.5">
              Compute loan EMIs across Weekly, Bi-Weekly, Fortnightly, or Monthly cycles with automatic bank holiday shifting and daily deposit queues.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onOpenBankHolidays}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors whitespace-nowrap shrink-0"
          >
            <CalendarDays className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
            <span>Bank Holidays ({holidays.length})</span>
          </button>

          <button
            type="button"
            onClick={startNewSchedule}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] transition-colors whitespace-nowrap shrink-0"
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
      <section className="bg-white border border-[#D9E2EC] rounded-lg overflow-hidden shadow-xs">
        <div className="px-5 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#102A43]">
              Customer PDC / Loan Schedules ({schedules.length})
            </h3>
            <p className="text-xs text-[#627D98]">
              Click any schedule to inspect loan principal/interest splits, holiday shifts, and clearing batch status.
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-[#627D98] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search customer, loan ref, cheque #..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
            />
          </div>
        </div>

        {filteredSchedules.length === 0 ? (
          <div className="py-12 px-5 text-center space-y-3">
            <CalendarCheck2 className="w-8 h-8 text-[#D9E2EC] mx-auto" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-[#102A43]">
                {schedules.length === 0
                  ? 'No Customer PDC / Loan Schedules Created Yet'
                  : 'No schedules match your search'}
              </p>
              <p className="text-xs text-[#627D98] max-w-md mx-auto">
                Use the built-in Loan / Installment Scheme Calculator to compute EMIs, scan PDC cheque leaves on the right side, and auto-shift bank holidays.
              </p>
            </div>
            {schedules.length === 0 && (
              <button
                type="button"
                onClick={startNewSchedule}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Schedule</span>
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-[#D9E2EC]">
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
                  <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#F4F7FA]/80 transition-colors">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedScheduleId((id) =>
                          id === sch.id ? null : sch.id
                        )
                      }
                      className="flex items-start gap-3 text-left flex-1 min-w-0"
                    >
                      <span className="mt-0.5 text-[#627D98] shrink-0">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-[#176B87]" />
                        ) : (
                          <ChevronRight className="w-4 h-4" />
                        )}
                      </span>
                      {firstThumb?.thumbnailDataUrl && (
                        <img
                          src={firstThumb.thumbnailDataUrl}
                          alt={firstThumb.fileName}
                          className="w-12 h-9 object-cover rounded border border-[#D9E2EC] shrink-0"
                        />
                      )}
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#102A43]">
                            {sch.customerName}
                          </span>
                          {sch.loanRefNo && (
                            <span className="text-xs font-mono-num text-[#176B87]">
                              · Ref: {sch.loanRefNo}
                            </span>
                          )}
                          {sch.frequency && (
                            <span className="text-[11px] text-[#627D98]">
                              · {getFrequencyLabel(sch.frequency)}
                            </span>
                          )}
                          {sch.holidayAutoShift && (
                            <span className="text-[10px] font-medium text-[#16A34A]">
                              · Holiday Auto-Shift ON
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#627D98] flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <span>
                            {sch.draweeBank || 'Bank N/A'}
                            {sch.draweeBranch ? ` (${sch.draweeBranch})` : ''}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num font-semibold text-[#102A43]">
                            {sch.cheques.length} Dues · {formatINR(totalVal)}
                          </span>
                          {sch.principalAmount !== undefined &&
                            sch.principalAmount > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono-num text-[#627D98]">
                                  Principal {formatINR(sch.principalAmount)}
                                  {sch.interestType &&
                                  sch.interestType !== 'ZERO_INTEREST'
                                    ? ` (${getInterestTypeLabel(sch.interestType)} ${sch.interestRate ?? 0}%)`
                                    : ''}
                                </span>
                              </>
                            )}
                          <span aria-hidden="true">·</span>
                          <span className="font-mono-num text-[#627D98]">
                            {scheduledCnt} Scheduled · {inClearingCnt} In Clearing ·{' '}
                            {clearedCnt} Cleared
                          </span>
                          {sch.scannedDocuments.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="inline-flex items-center gap-1 text-[#176B87] font-medium">
                                <FileImage className="w-3 h-3" />
                                <span>{sch.scannedDocuments.length} Scan(s)</span>
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDownloadCustomerPdfFromSchedule(sch)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#176B87] rounded-md hover:bg-[#102A43] transition-colors whitespace-nowrap"
                        title={`Download PDF Statement for ${sch.customerName}`}
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download PDF</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditSchedule(sch)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors whitespace-nowrap"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-[#176B87]" />
                        <span>Edit / Scan</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => onDeleteSchedule(sch.id)}
                        title="Delete Schedule"
                        className="p-1.5 text-[#627D98] hover:text-[#DC2626] rounded hover:bg-[#DC2626]/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {isExpanded && (() => {
                    const rowsWithBal = computeScheduleRowsWithBalance(
                      sch.cheques || []
                    );
                    const paidSum = round2(
                      (sch.cheques || []).reduce((s, row) => {
                        const info = resolveInstallmentPaidInfo(row, chequeById);
                        return info.isPaid ? s + (row.amount || 0) : s;
                      }, 0)
                    );
                    const outstandingBal = Math.max(0, round2(totalVal - paidSum));

                    return (
                      <div className="px-5 pb-4 pt-2 bg-[#F4F7FA] border-t border-[#D9E2EC] space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="flex flex-wrap items-center gap-4 font-mono-num text-[#627D98]">
                            <span>
                              Total Payable:{' '}
                              <strong className="text-[#102A43]">
                                {formatINR(totalVal)}
                              </strong>
                            </span>
                            <span>
                              Paid (Cleared):{' '}
                              <strong className="text-[#16A34A]">
                                {formatINR(paidSum)}
                              </strong>
                            </span>
                            <span>
                              Outstanding Loan Balance:{' '}
                              <strong className="text-[#102A43]">
                                {formatINR(outstandingBal)}
                              </strong>
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              handleDownloadCustomerPdfFromSchedule(sch)
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-[#243B53] bg-white border border-[#D9E2EC] rounded hover:bg-[#F4F7FA] whitespace-nowrap"
                          >
                            <Download className="w-3 h-3 text-[#176B87]" />
                            <span>Download Customer Statement PDF</span>
                          </button>
                        </div>

                        <div className="overflow-x-auto border border-[#D9E2EC] rounded-md bg-white">
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="border-b border-[#D9E2EC] bg-[#F4F7FA] text-[11px] font-semibold text-[#627D98]">
                                <th className="py-2 px-3">Inst. #</th>
                                <th className="py-2 px-3">Due Date</th>
                                <th className="py-2 px-3">
                                  Effective Deposit Date
                                </th>
                                <th className="py-2 px-3">Cheque No</th>
                                <th className="py-2 px-3 text-right">
                                  Principal (₹)
                                </th>
                                <th className="py-2 px-3 text-right">
                                  Interest (₹)
                                </th>
                                <th className="py-2 px-3 text-right">
                                  Due Amount (₹)
                                </th>
                                <th className="py-2 px-3">Paid Status</th>
                                <th className="py-2 px-3 text-right">
                                  Balance (₹)
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#D9E2EC]">
                              {rowsWithBal.map(({ item, runningBalance }, idx) => {
                                const wasShifted =
                                  item.effectiveDate !== item.originalDate;
                                const paidInfo = resolveInstallmentPaidInfo(
                                  item,
                                  chequeById
                                );
                                return (
                                  <tr key={item.id} className="hover:bg-[#F4F7FA]/70">
                                    <td className="py-2 px-3 font-mono-num text-[#627D98]">
                                      {item.dueNumber ?? idx + 1}
                                    </td>
                                    <td className="py-2 px-3 font-mono-num text-[#627D98]">
                                      {formatIndianDate(item.originalDate)}
                                    </td>
                                    <td className="py-2 px-3">
                                      <span className="font-mono-num font-semibold text-[#102A43]">
                                        {formatIndianDate(item.effectiveDate)}
                                      </span>
                                      {wasShifted && (
                                        <span className="ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#F59E0B]/10 text-[#B45309] border border-[#F59E0B]/30">
                                          Shifted (Holiday)
                                        </span>
                                      )}
                                      {item.shiftReason && (
                                        <span className="ml-1.5 text-[10px] text-[#B45309]">
                                          {item.shiftReason}
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-2 px-3 font-mono-num font-semibold text-[#176B87]">
                                      {item.chequeNumber}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono-num text-[#243B53]">
                                      {formatINR(
                                        item.principalAmount ?? item.amount
                                      )}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono-num text-[#627D98]">
                                      {formatINR(item.interestAmount ?? 0)}
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono-num font-semibold text-[#102A43]">
                                      {formatINR(item.amount)}
                                    </td>
                                    <td className="py-2 px-3">
                                      <span
                                        className={`font-semibold ${
                                          paidInfo.isPaid
                                            ? 'text-[#16A34A]'
                                            : paidInfo.effectiveStatus ===
                                              'Returned / Bounced'
                                            ? 'text-[#DC2626]'
                                            : paidInfo.effectiveStatus ===
                                              'In Clearing'
                                            ? 'text-[#2563EB]'
                                            : 'text-[#64748B]'
                                        }`}
                                      >
                                        {paidInfo.paidLabel}
                                        {item.clearingBatchRef
                                          ? ` (${item.clearingBatchRef})`
                                          : ''}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-right font-mono-num font-semibold text-[#102A43]">
                                      {formatINR(item.balance ?? runningBalance)}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
