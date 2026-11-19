import {
  BankHoliday,
  LoanInterestType,
  ScheduleFrequency,
  ScheduledChequeItem,
} from '../types/treasury';
import {
  computeDueDateByFrequency,
  incrementChequeNumber,
  resolveEffectiveWorkingDate,
} from './bankHolidays';

export interface LoanSchemeInput {
  principalAmount: number;
  numberOfDues: number;
  interestRate: number;
  interestType: LoanInterestType;
  frequency: ScheduleFrequency;
  customIntervalDays?: number;
  roundDueToNearestRupee: boolean;
}

export interface LoanInstallmentSplit {
  dueNumber: number;
  principalAmount: number;
  interestAmount: number;
  amount: number;
  balance: number;
}

export interface LoanSchemeSummary {
  principalAmount: number;
  numberOfDues: number;
  interestRate: number;
  interestType: LoanInterestType;
  frequency: ScheduleFrequency;
  tenureYears: number;
  tenureMonths: number;
  periodsPerYear: number;
  totalInterest: number;
  totalPayable: number;
  exactDueAmount: number;
  autoDueAmount: number;
  finalDueAmount: number;
  hasFinalRoundingAdjustment: boolean;
  installments: LoanInstallmentSplit[];
}

export const SCHEDULE_FREQUENCY_OPTIONS: {
  value: ScheduleFrequency;
  label: string;
  shortLabel: string;
  intervalHint: string;
}[] = [
  {
    value: 'Weekly',
    label: 'Weekly (+7 Days)',
    shortLabel: 'Weekly',
    intervalHint: '+7 days per due',
  },
  {
    value: 'Bi-Weekly',
    label: 'Bi-Weekly (+14 Days)',
    shortLabel: 'Bi-Weekly',
    intervalHint: '+14 days per due',
  },
  {
    value: 'Fortnightly',
    label: '15 Days Once (Fortnightly)',
    shortLabel: '15 Days Once',
    intervalHint: '+15 days per due',
  },
  {
    value: 'Monthly',
    label: 'Monthly (+1 Month)',
    shortLabel: 'Monthly',
    intervalHint: '+1 month per due',
  },
];

export const INTEREST_TYPE_OPTIONS: {
  value: LoanInterestType;
  label: string;
  shortLabel: string;
  formulaHint: string;
}[] = [
  {
    value: 'FLAT_PA',
    label: 'Flat Rate (% per annum)',
    shortLabel: 'Flat % p.a.',
    formulaHint: 'Principal × (Rate / 100) × Years',
  },
  {
    value: 'FLAT_PM',
    label: 'Flat Rate (% per month)',
    shortLabel: 'Flat % p.m.',
    formulaHint: 'Principal × (Monthly Rate / 100) × Months',
  },
  {
    value: 'REDUCING_EMI',
    label: 'Reducing Balance (EMI % p.a.)',
    shortLabel: 'Reducing EMI',
    formulaHint: 'P × r × (1+r)^N / ((1+r)^N - 1)',
  },
  {
    value: 'ZERO_INTEREST',
    label: '0% Interest (Principal Only)',
    shortLabel: '0% Interest',
    formulaHint: 'Loan Principal / Number of Dues',
  },
];

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function getPeriodsPerYear(
  frequency: ScheduleFrequency,
  customIntervalDays = 30
): number {
  switch (frequency) {
    case 'Weekly':
      return 52;
    case 'Bi-Weekly':
      return 26;
    case 'Fortnightly':
      return 24;
    case 'Monthly':
      return 12;
    case 'Custom':
    default: {
      const days = Math.max(1, customIntervalDays || 30);
      return 365 / days;
    }
  }
}

export function getFrequencyLabel(frequency?: ScheduleFrequency): string {
  switch (frequency) {
    case 'Weekly':
      return 'Weekly (+7d)';
    case 'Bi-Weekly':
      return 'Bi-Weekly (+14d)';
    case 'Fortnightly':
      return '15 Days Once (Fortnightly)';
    case 'Monthly':
      return 'Monthly';
    case 'Custom':
      return 'Custom Days';
    default:
      return 'Scheduled';
  }
}

export function getInterestTypeLabel(type?: LoanInterestType): string {
  const found = INTEREST_TYPE_OPTIONS.find((opt) => opt.value === type);
  return found ? found.shortLabel : 'Standard';
}

export function calculateLoanScheme(input: LoanSchemeInput): LoanSchemeSummary {
  const P = Math.max(0, round2(Number(input.principalAmount) || 0));
  const N = Math.max(1, Math.min(120, Math.floor(Number(input.numberOfDues) || 1)));
  const R =
    input.interestType === 'ZERO_INTEREST'
      ? 0
      : Math.max(0, Number(input.interestRate) || 0);
  const periodsPerYear = getPeriodsPerYear(
    input.frequency,
    input.customIntervalDays
  );
  const tenureYears = N / periodsPerYear;
  const tenureMonths = tenureYears * 12;

  // 1) Zero interest or zero rate / principal
  if (input.interestType === 'ZERO_INTEREST' || R === 0 || P === 0) {
    const totalPayable = round2(P);
    const exactDueAmount = totalPayable / N;
    const baseDue = input.roundDueToNearestRupee
      ? Math.round(exactDueAmount)
      : round2(exactDueAmount);

    const installments: LoanInstallmentSplit[] = [];
    let remainingPayable = totalPayable;
    for (let i = 0; i < N; i++) {
      const isLast = i === N - 1;
      const due = isLast
        ? Math.max(0, round2(totalPayable - baseDue * (N - 1)))
        : baseDue;
      remainingPayable = isLast
        ? 0
        : Math.max(0, round2(remainingPayable - due));
      installments.push({
        dueNumber: i + 1,
        principalAmount: due,
        interestAmount: 0,
        amount: due,
        balance: remainingPayable,
      });
    }

    const finalDue = installments[N - 1]?.amount ?? baseDue;
    return {
      principalAmount: P,
      numberOfDues: N,
      interestRate: R,
      interestType: input.interestType,
      frequency: input.frequency,
      tenureYears,
      tenureMonths,
      periodsPerYear,
      totalInterest: 0,
      totalPayable,
      exactDueAmount: round2(exactDueAmount),
      autoDueAmount: baseDue,
      finalDueAmount: finalDue,
      hasFinalRoundingAdjustment:
        N > 1 && Math.abs(finalDue - baseDue) > 0.005,
      installments,
    };
  }

  // 2) Flat Rate (% per annum or % per month)
  if (input.interestType === 'FLAT_PA' || input.interestType === 'FLAT_PM') {
    const rawTotalInterest =
      input.interestType === 'FLAT_PA'
        ? P * (R / 100) * tenureYears
        : P * (R / 100) * tenureMonths;
    const totalInterest = round2(rawTotalInterest);
    const totalPayable = round2(P + totalInterest);
    const exactDueAmount = totalPayable / N;

    const basePrincipal = round2(P / N);
    const baseDue = input.roundDueToNearestRupee
      ? Math.round(exactDueAmount)
      : round2(exactDueAmount);

    const installments: LoanInstallmentSplit[] = [];
    let remainingPayable = totalPayable;
    for (let i = 0; i < N; i++) {
      const isLast = i === N - 1;
      const principalPart = isLast
        ? round2(P - basePrincipal * (N - 1))
        : basePrincipal;
      const due = isLast
        ? Math.max(0, round2(totalPayable - baseDue * (N - 1)))
        : baseDue;
      const interestPart = round2(due - principalPart);
      remainingPayable = isLast
        ? 0
        : Math.max(0, round2(remainingPayable - due));
      installments.push({
        dueNumber: i + 1,
        principalAmount: principalPart,
        interestAmount: interestPart,
        amount: due,
        balance: remainingPayable,
      });
    }

    const finalDue = installments[N - 1]?.amount ?? baseDue;
    return {
      principalAmount: P,
      numberOfDues: N,
      interestRate: R,
      interestType: input.interestType,
      frequency: input.frequency,
      tenureYears,
      tenureMonths,
      periodsPerYear,
      totalInterest,
      totalPayable,
      exactDueAmount: round2(exactDueAmount),
      autoDueAmount: baseDue,
      finalDueAmount: finalDue,
      hasFinalRoundingAdjustment:
        N > 1 && Math.abs(finalDue - baseDue) > 0.005,
      installments,
    };
  }

  // 3) Reducing Balance (EMI) — R is annual nominal %
  const periodicRate = R / 100 / periodsPerYear;
  const pow = Math.pow(1 + periodicRate, N);
  const exactEmi =
    pow > 1 ? (P * periodicRate * pow) / (pow - 1) : P / N;
  const exactTotalPayable = round2(exactEmi * N);
  const baseDue = input.roundDueToNearestRupee
    ? Math.round(exactEmi)
    : round2(exactEmi);

  const installments: LoanInstallmentSplit[] = [];
  let outstanding = P;

  for (let i = 0; i < N; i++) {
    const isLast = i === N - 1;
    const rawInterest = round2(outstanding * periodicRate);

    if (!isLast) {
      const due = baseDue;
      const principalPart = round2(due - rawInterest);
      outstanding = round2(outstanding - principalPart);
      installments.push({
        dueNumber: i + 1,
        principalAmount: principalPart,
        interestAmount: rawInterest,
        amount: due,
        balance: 0,
      });
    } else if (input.roundDueToNearestRupee) {
      const due = Math.max(0, round2(exactTotalPayable - baseDue * (N - 1)));
      const principalPart = round2(outstanding);
      const interestPart = round2(due - principalPart);
      installments.push({
        dueNumber: i + 1,
        principalAmount: principalPart,
        interestAmount: interestPart,
        amount: due,
        balance: 0,
      });
    } else {
      const principalPart = round2(outstanding);
      const due = round2(principalPart + rawInterest);
      installments.push({
        dueNumber: i + 1,
        principalAmount: principalPart,
        interestAmount: rawInterest,
        amount: due,
        balance: 0,
      });
    }
  }

  const totalPayable = round2(
    installments.reduce((sum, row) => sum + row.amount, 0)
  );
  let remainingPayable = totalPayable;
  for (let i = 0; i < installments.length; i++) {
    const isLast = i === installments.length - 1;
    remainingPayable = isLast
      ? 0
      : Math.max(0, round2(remainingPayable - installments[i].amount));
    installments[i].balance = remainingPayable;
  }

  const totalInterest = round2(totalPayable - P);
  const finalDue = installments[N - 1]?.amount ?? baseDue;

  return {
    principalAmount: P,
    numberOfDues: N,
    interestRate: R,
    interestType: input.interestType,
    frequency: input.frequency,
    tenureYears,
    tenureMonths,
    periodsPerYear,
    totalInterest,
    totalPayable,
    exactDueAmount: round2(exactEmi),
    autoDueAmount: baseDue,
    finalDueAmount: finalDue,
    hasFinalRoundingAdjustment:
      N > 1 && Math.abs(finalDue - baseDue) > 0.005,
    installments,
  };
}

export function generateLoanScheduleItems(params: {
  startDate: string;
  frequency: ScheduleFrequency;
  customIntervalDays?: number;
  startingChequeNumber: string;
  holidayAutoShift: boolean;
  holidays: BankHoliday[];
  summary: LoanSchemeSummary;
  dueStartOffset?: number;
}): ScheduledChequeItem[] {
  const {
    startDate,
    frequency,
    customIntervalDays = 30,
    startingChequeNumber,
    holidayAutoShift,
    holidays,
    summary,
    dueStartOffset = 0,
  } = params;

  const stamp = Date.now();
  return summary.installments.map((inst, idx) => {
    const seqIdx = dueStartOffset + idx;
    const originalDate = computeDueDateByFrequency(
      startDate,
      seqIdx,
      frequency,
      customIntervalDays
    );
    const resolved = resolveEffectiveWorkingDate(
      originalDate,
      holidayAutoShift,
      holidays
    );

    return {
      id: `sch-chq-${stamp}-${seqIdx}-${Math.random().toString(36).slice(2, 6)}`,
      dueNumber: seqIdx + 1,
      chequeNumber: incrementChequeNumber(startingChequeNumber || '001001', seqIdx),
      originalDate,
      effectiveDate: resolved.effectiveDate,
      shiftReason: resolved.shiftReason || resolved.leaveWarning,
      principalAmount: inst.principalAmount,
      interestAmount: inst.interestAmount,
      amount: inst.amount,
      balance: inst.balance,
      status: 'Scheduled',
    };
  });
}

export function computeScheduleRowsWithBalance(
  rows: ScheduledChequeItem[]
): { item: ScheduledChequeItem; runningBalance: number }[] {
  const totalPayable = round2(
    rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
  );
  let remaining = totalPayable;
  return rows.map((item, idx) => {
    const isLast = idx === rows.length - 1;
    remaining = isLast
      ? 0
      : Math.max(0, round2(remaining - (Number(item.amount) || 0)));
    return {
      item,
      runningBalance: remaining,
    };
  });
}
