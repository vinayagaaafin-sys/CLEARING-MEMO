import {
  BankHoliday,
  CustomerChequeSchedule,
  ScheduleFrequency,
  ScheduledChequeItem,
} from '../types/treasury';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export function formatShortDayDate(dateStr: string): string {
  if (!dateStr) return '—';
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  const dayName = SHORT_DAYS[dt.getDay()];
  const day = String(dt.getDate()).padStart(2, '0');
  const mon = SHORT_MONTHS[dt.getMonth()];
  return `${dayName} ${day}-${mon}`;
}

export function getDefaultIndianBankHolidays(): BankHoliday[] {
  const presets: Omit<BankHoliday, 'isDefault'>[] = [
    // 2025 Standard Indian & Tamil Nadu Bank Holidays
    { id: 'hol-2025-01-01', date: '2025-01-01', name: 'New Year Day', category: 'Tamil Nadu' },
    { id: 'hol-2025-01-14', date: '2025-01-14', name: 'Pongal', category: 'Tamil Nadu' },
    { id: 'hol-2025-01-15', date: '2025-01-15', name: 'Thiruvalluvar Day', category: 'Tamil Nadu' },
    { id: 'hol-2025-01-16', date: '2025-01-16', name: 'Uzhavar Thirunal', category: 'Tamil Nadu' },
    { id: 'hol-2025-01-26', date: '2025-01-26', name: 'Republic Day', category: 'National' },
    { id: 'hol-2025-03-31', date: '2025-03-31', name: 'Ramzan (Id-ul-Fitr)', category: 'National' },
    { id: 'hol-2025-04-01', date: '2025-04-01', name: 'Annual Bank Closing of Accounts', category: 'National' },
    { id: 'hol-2025-04-14', date: '2025-04-14', name: 'Tamil New Year / Dr. Ambedkar Jayanti', category: 'Tamil Nadu' },
    { id: 'hol-2025-04-18', date: '2025-04-18', name: 'Good Friday', category: 'National' },
    { id: 'hol-2025-05-01', date: '2025-05-01', name: 'May Day', category: 'Tamil Nadu' },
    { id: 'hol-2025-08-15', date: '2025-08-15', name: 'Independence Day', category: 'National' },
    { id: 'hol-2025-08-27', date: '2025-08-27', name: 'Vinayakar Chaturthi', category: 'Tamil Nadu' },
    { id: 'hol-2025-10-01', date: '2025-10-01', name: 'Ayudha Pooja', category: 'Tamil Nadu' },
    { id: 'hol-2025-10-02', date: '2025-10-02', name: 'Gandhi Jayanti / Vijaya Dasami', category: 'National' },
    { id: 'hol-2025-10-20', date: '2025-10-20', name: 'Diwali (Deepavali)', category: 'National' },
    { id: 'hol-2025-12-25', date: '2025-12-25', name: 'Christmas', category: 'National' },

    // 2026 Standard Indian & Tamil Nadu Bank Holidays
    { id: 'hol-2026-01-01', date: '2026-01-01', name: 'New Year Day', category: 'Tamil Nadu' },
    { id: 'hol-2026-01-15', date: '2026-01-15', name: 'Pongal', category: 'Tamil Nadu' },
    { id: 'hol-2026-01-16', date: '2026-01-16', name: 'Thiruvalluvar Day', category: 'Tamil Nadu' },
    { id: 'hol-2026-01-17', date: '2026-01-17', name: 'Uzhavar Thirunal', category: 'Tamil Nadu' },
    { id: 'hol-2026-01-26', date: '2026-01-26', name: 'Republic Day', category: 'National' },
    { id: 'hol-2026-03-20', date: '2026-03-20', name: 'Ramzan (Id-ul-Fitr)', category: 'National' },
    { id: 'hol-2026-03-21', date: '2026-03-21', name: 'Telugu New Year (Ugadi)', category: 'Tamil Nadu' },
    { id: 'hol-2026-04-01', date: '2026-04-01', name: 'Annual Bank Closing of Accounts', category: 'National' },
    { id: 'hol-2026-04-03', date: '2026-04-03', name: 'Good Friday', category: 'National' },
    { id: 'hol-2026-04-14', date: '2026-04-14', name: 'Tamil New Year / Dr. Ambedkar Jayanti', category: 'Tamil Nadu' },
    { id: 'hol-2026-05-01', date: '2026-05-01', name: 'May Day', category: 'Tamil Nadu' },
    { id: 'hol-2026-05-27', date: '2026-05-27', name: 'Bakrid (Id-ul-Zuha)', category: 'National' },
    { id: 'hol-2026-06-26', date: '2026-06-26', name: 'Muharram', category: 'National' },
    { id: 'hol-2026-08-15', date: '2026-08-15', name: 'Independence Day', category: 'National' },
    { id: 'hol-2026-08-26', date: '2026-08-26', name: 'Milad-un-Nabi', category: 'National' },
    { id: 'hol-2026-09-04', date: '2026-09-04', name: 'Krishna Jayanthi', category: 'Tamil Nadu' },
    { id: 'hol-2026-09-14', date: '2026-09-14', name: 'Vinayakar Chaturthi', category: 'Tamil Nadu' },
    { id: 'hol-2026-10-02', date: '2026-10-02', name: 'Gandhi Jayanti', category: 'National' },
    { id: 'hol-2026-10-19', date: '2026-10-19', name: 'Ayudha Pooja', category: 'Tamil Nadu' },
    { id: 'hol-2026-10-20', date: '2026-10-20', name: 'Vijaya Dasami', category: 'Tamil Nadu' },
    { id: 'hol-2026-11-08', date: '2026-11-08', name: 'Diwali (Deepavali)', category: 'National' },
    { id: 'hol-2026-11-24', date: '2026-11-24', name: 'Guru Nanak Jayanti', category: 'National' },
    { id: 'hol-2026-12-25', date: '2026-12-25', name: 'Christmas', category: 'National' },

    // 2027 Standard Indian & Tamil Nadu Bank Holidays
    { id: 'hol-2027-01-01', date: '2027-01-01', name: 'New Year Day', category: 'Tamil Nadu' },
    { id: 'hol-2027-01-15', date: '2027-01-15', name: 'Pongal', category: 'Tamil Nadu' },
    { id: 'hol-2027-01-16', date: '2027-01-16', name: 'Thiruvalluvar Day', category: 'Tamil Nadu' },
    { id: 'hol-2027-01-26', date: '2027-01-26', name: 'Republic Day', category: 'National' },
    { id: 'hol-2027-03-26', date: '2027-03-26', name: 'Good Friday', category: 'National' },
    { id: 'hol-2027-04-01', date: '2027-04-01', name: 'Annual Bank Closing of Accounts', category: 'National' },
    { id: 'hol-2027-04-14', date: '2027-04-14', name: 'Tamil New Year / Dr. Ambedkar Jayanti', category: 'Tamil Nadu' },
    { id: 'hol-2027-05-01', date: '2027-05-01', name: 'May Day', category: 'Tamil Nadu' },
    { id: 'hol-2027-08-15', date: '2027-08-15', name: 'Independence Day', category: 'National' },
    { id: 'hol-2027-10-02', date: '2027-10-02', name: 'Gandhi Jayanti', category: 'National' },
    { id: 'hol-2027-10-29', date: '2027-10-29', name: 'Diwali (Deepavali)', category: 'National' },
    { id: 'hol-2027-12-25', date: '2027-12-25', name: 'Christmas', category: 'National' },
  ];

  return presets.map((h) => ({ ...h, isDefault: true }));
}

export function toIsoDate(dt: Date): string {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysIso(dateStr: string, days: number): string {
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  dt.setDate(dt.getDate() + days);
  return toIsoDate(dt);
}

export function addMonthsIso(dateStr: string, months: number): string {
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  const origDay = dt.getDate();
  dt.setDate(1);
  dt.setMonth(dt.getMonth() + months);
  const lastDayOfTargetMonth = new Date(
    dt.getFullYear(),
    dt.getMonth() + 1,
    0
  ).getDate();
  dt.setDate(Math.min(origDay, lastDayOfTargetMonth));
  return toIsoDate(dt);
}

export function isBankHolidayDate(
  dateStr: string,
  holidays: BankHoliday[]
): { isHoliday: boolean; reason: string; kind?: 'SUNDAY' | 'SECOND_FOURTH_SAT' | 'HOLIDAY' } {
  if (!dateStr) return { isHoliday: false, reason: '' };
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return { isHoliday: false, reason: '' };

  const dayOfWeek = dt.getDay();
  if (dayOfWeek === 0) {
    return { isHoliday: true, reason: 'Sunday', kind: 'SUNDAY' };
  }

  if (dayOfWeek === 6) {
    const nthSaturday = Math.ceil(dt.getDate() / 7);
    if (nthSaturday === 2) {
      return {
        isHoliday: true,
        reason: '2nd Saturday Bank Off',
        kind: 'SECOND_FOURTH_SAT',
      };
    }
    if (nthSaturday === 4) {
      return {
        isHoliday: true,
        reason: '4th Saturday Bank Off',
        kind: 'SECOND_FOURTH_SAT',
      };
    }
  }

  const matchedHoliday = holidays.find((h) => h.date === dateStr);
  if (matchedHoliday) {
    return {
      isHoliday: true,
      reason: matchedHoliday.name,
      kind: 'HOLIDAY',
    };
  }

  return { isHoliday: false, reason: '' };
}

export function resolveEffectiveWorkingDate(
  originalDate: string,
  holidayAutoShift: boolean,
  holidays: BankHoliday[]
): {
  effectiveDate: string;
  wasShifted: boolean;
  shiftReason?: string;
  leaveWarning?: string;
} {
  if (!originalDate) {
    return { effectiveDate: originalDate, wasShifted: false };
  }

  const initialCheck = isBankHolidayDate(originalDate, holidays);
  if (!initialCheck.isHoliday) {
    return { effectiveDate: originalDate, wasShifted: false };
  }

  if (!holidayAutoShift) {
    return {
      effectiveDate: originalDate,
      wasShifted: false,
      leaveWarning: `Falls on Bank Leave (${initialCheck.reason})`,
    };
  }

  let cursor = originalDate;
  let guard = 0;
  while (guard < 30) {
    const check = isBankHolidayDate(cursor, holidays);
    if (!check.isHoliday) break;
    cursor = addDaysIso(cursor, 1);
    guard += 1;
  }

  const origShort = formatShortDayDate(originalDate);
  const effShort = formatShortDayDate(cursor);
  const reasonTag =
    initialCheck.kind === 'SUNDAY'
      ? ''
      : ` (${initialCheck.reason})`;

  return {
    effectiveDate: cursor,
    wasShifted: cursor !== originalDate,
    shiftReason: `Shifted from ${origShort}${reasonTag} -> ${effShort}`,
  };
}

export function incrementChequeNumber(startChequeNo: string, offset: number): string {
  const trimmed = startChequeNo.trim();
  if (!trimmed) return String(offset + 1).padStart(6, '0');
  const match = trimmed.match(/^(.*?)(\d+)$/);
  if (!match) return trimmed;
  const [, prefix, digits] = match;
  const width = digits.length;
  const nextVal = parseInt(digits, 10) + offset;
  return `${prefix}${String(nextVal).padStart(width, '0')}`;
}

export function generateRecurringChequeItems(params: {
  startDate: string;
  frequency: ScheduleFrequency;
  customIntervalDays?: number;
  count: number;
  startingChequeNumber: string;
  amountPerCheque: number;
  holidayAutoShift: boolean;
  holidays: BankHoliday[];
}): ScheduledChequeItem[] {
  const {
    startDate,
    frequency,
    customIntervalDays = 30,
    count,
    startingChequeNumber,
    amountPerCheque,
    holidayAutoShift,
    holidays,
  } = params;

  const safeCount = Math.max(1, Math.min(120, Math.floor(count || 1)));
  const interval = Math.max(1, Math.floor(customIntervalDays || 30));
  const items: ScheduledChequeItem[] = [];

  for (let i = 0; i < safeCount; i++) {
    const originalDate =
      frequency === 'Monthly'
        ? addMonthsIso(startDate, i)
        : frequency === 'Weekly'
        ? addDaysIso(startDate, i * 7)
        : addDaysIso(startDate, i * interval);

    const resolved = resolveEffectiveWorkingDate(
      originalDate,
      holidayAutoShift,
      holidays
    );

    items.push({
      id: `sch-chq-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      chequeNumber: incrementChequeNumber(startingChequeNumber, i),
      originalDate,
      effectiveDate: resolved.effectiveDate,
      shiftReason: resolved.shiftReason || resolved.leaveWarning,
      amount: amountPerCheque,
      status: 'Scheduled',
    });
  }

  return items;
}

export function recalculateScheduleDates(
  schedules: CustomerChequeSchedule[],
  holidays: BankHoliday[]
): CustomerChequeSchedule[] {
  return schedules.map((sch) => ({
    ...sch,
    cheques: (sch.cheques || []).map((item) => {
      // Keep non-Scheduled cheques at their locked/cleared date
      if (item.status !== 'Scheduled') return item;
      const resolved = resolveEffectiveWorkingDate(
        item.originalDate,
        sch.holidayAutoShift,
        holidays
      );
      return {
        ...item,
        effectiveDate: resolved.effectiveDate,
        shiftReason: resolved.shiftReason || resolved.leaveWarning,
      };
    }),
  }));
}
