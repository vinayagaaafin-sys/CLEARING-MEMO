import React, { useMemo, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { BankHoliday, CustomerChequeSchedule } from '../types/treasury';
import {
  getDefaultIndianBankHolidays,
  isBankHolidayDate,
  toIsoDate,
} from '../utils/bankHolidays';
import { formatIndianDate } from '../utils/indianCurrency';

interface BankHolidayDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  holidays: BankHoliday[];
  schedules: CustomerChequeSchedule[];
  onAddHoliday: (holiday: Omit<BankHoliday, 'id'>) => void;
  onDeleteHoliday: (holidayId: string) => void;
  onRestoreDefaults: () => void;
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function BankHolidayDrawer({
  isOpen,
  onClose,
  holidays,
  schedules,
  onAddHoliday,
  onDeleteHoliday,
  onRestoreDefaults,
}: BankHolidayDrawerProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const [newDate, setNewDate] = useState(todayIso);
  const [newName, setNewName] = useState('');
  const [newCategory, setNewCategory] =
    useState<BankHoliday['category']>('Custom');
  const [searchQuery, setSearchQuery] = useState('');
  const [calendarMonth, setCalendarMonth] = useState(() => todayIso.slice(0, 7));

  const scheduledCountsByAffected = useMemo(() => {
    let shiftedCount = 0;
    let unshiftedLeaveFlagCount = 0;
    for (const sch of schedules) {
      for (const chq of sch.cheques || []) {
        if (chq.status !== 'Scheduled') continue;
        if (chq.effectiveDate !== chq.originalDate) {
          shiftedCount += 1;
        } else if (isBankHolidayDate(chq.originalDate, holidays).isHoliday) {
          unshiftedLeaveFlagCount += 1;
        }
      }
    }
    return { shiftedCount, unshiftedLeaveFlagCount };
  }, [schedules, holidays]);

  const sortedHolidays = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return [...holidays]
      .filter((h) => {
        if (!q) return true;
        return (
          h.name.toLowerCase().includes(q) ||
          h.date.includes(q) ||
          h.category.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [holidays, searchQuery]);

  const calendarCells = useMemo(() => {
    const [yStr, mStr] = calendarMonth.split('-');
    const year = Number(yStr) || new Date().getFullYear();
    const monthIdx = (Number(mStr) || 1) - 1;
    const firstDay = new Date(year, monthIdx, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

    const cells: {
      iso: string | null;
      dayNum: number | null;
      status?: ReturnType<typeof isBankHolidayDate>;
    }[] = [];

    for (let i = 0; i < startWeekday; i++) {
      cells.push({ iso: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const iso = toIsoDate(new Date(year, monthIdx, d));
      cells.push({
        iso,
        dayNum: d,
        status: isBankHolidayDate(iso, holidays),
      });
    }
    return cells;
  }, [calendarMonth, holidays]);

  if (!isOpen) return null;

  const handleSubmitHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate || !newName.trim()) return;
    onAddHoliday({
      date: newDate,
      name: newName.trim(),
      category: newCategory,
      isDefault: false,
    });
    setNewName('');
  };

  return (
    <div
      className="no-print fixed inset-0 z-50 bg-[#102A43]/60 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bank-holiday-drawer-title"
    >
      <div className="bg-white w-full max-w-2xl h-full overflow-y-auto border-l border-[#D9E2EC] flex flex-col justify-between shadow-xl">
        <div>
          {/* Header */}
          <div className="sticky top-0 z-10 bg-white border-b border-[#D9E2EC] px-6 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-md bg-[#102A43] text-[#14B8A6] border border-[#D4AF37]/40 flex items-center justify-center shrink-0">
                <CalendarDays className="w-4 h-4" aria-hidden="true" />
              </div>
              <div>
                <h2
                  id="bank-holiday-drawer-title"
                  className="text-sm font-semibold text-[#102A43]"
                >
                  Bank Holiday Calendar &amp; Working-Day Rules
                </h2>
                <p className="text-xs text-[#627D98]">
                  Adding or removing a holiday automatically recalculates scheduled PDC deposit dates.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#627D98] hover:text-[#102A43] rounded-md hover:bg-[#F4F7FA] transition-colors"
              aria-label="Close Bank Holidays drawer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-6">
            {/* Automatic Weekend Leave Rules */}
            <div className="p-4 bg-[#F4F7FA] border border-[#D9E2EC] rounded-lg space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#102A43] flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                  Automatic RBI Clearing Leave Rules Active
                </span>
                <span className="text-[11px] font-mono-num text-[#627D98]">
                  {holidays.length} Configured Holidays
                </span>
              </div>
              <p className="text-xs text-[#243B53] leading-relaxed">
                All <strong>Sundays</strong> and every{' '}
                <strong>2nd &amp; 4th Saturday</strong> of each month are automatically treated as non-working bank days across all schedules.
              </p>
              <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px] text-[#243B53]">
                <span>
                  Auto-Shifted Cheques:{' '}
                  <strong className="font-mono-num text-[#102A43]">
                    {scheduledCountsByAffected.shiftedCount}
                  </strong>
                </span>
                {scheduledCountsByAffected.unshiftedLeaveFlagCount > 0 && (
                  <span className="text-[#B45309] font-medium">
                    Unshifted Cheques on Leave Days:{' '}
                    <strong className="font-mono-num">
                      {scheduledCountsByAffected.unshiftedLeaveFlagCount}
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {/* Add Custom Bank Holiday Form */}
            <form
              onSubmit={handleSubmitHoliday}
              className="border border-[#D9E2EC] rounded-lg p-4 space-y-3 bg-white"
            >
              <div className="text-xs font-semibold text-[#102A43]">
                Add Custom Bank Holiday (Local Bandh / Strike / Regional Festival)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-4">
                  <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                    Holiday Date
                  </label>
                  <input
                    type="date"
                    required
                    value={newDate}
                    onChange={(e) => setNewDate(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
                <div className="sm:col-span-5">
                  <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                    Holiday Name
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g., Bank Strike / Local Holiday"
                    className="w-full px-3 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-[11px] font-medium text-[#243B53] mb-1">
                    Category
                  </label>
                  <select
                    value={newCategory}
                    onChange={(e) =>
                      setNewCategory(e.target.value as BankHoliday['category'])
                    }
                    className="w-full px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  >
                    <option value="Custom">Custom</option>
                    <option value="Tamil Nadu">Tamil Nadu</option>
                    <option value="National">National</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={onRestoreDefaults}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#176B87] hover:text-[#102A43] transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    Restore Default Indian &amp; TN Holidays ({getDefaultIndianBankHolidays().length})
                  </span>
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] whitespace-nowrap shrink-0 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add Bank Holiday</span>
                </button>
              </div>
            </form>

            {/* Interactive Monthly Leave Visual Check */}
            <div className="border border-[#D9E2EC] rounded-lg p-4 space-y-3 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#102A43]">
                  Monthly Working-Day &amp; Leave Calendar Preview
                </span>
                <input
                  type="month"
                  value={calendarMonth}
                  onChange={(e) => setCalendarMonth(e.target.value)}
                  className="px-2.5 py-1 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>

              <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
                {WEEKDAY_HEADERS.map((w) => (
                  <div
                    key={w}
                    className="py-1 font-semibold text-[#627D98] uppercase"
                  >
                    {w}
                  </div>
                ))}
                {calendarCells.map((cell, idx) => {
                  if (!cell.iso || !cell.dayNum) {
                    return <div key={`empty-${idx}`} className="h-9" />;
                  }
                  const isLeave = cell.status?.isHoliday;
                  const isToday = cell.iso === todayIso;
                  return (
                    <div
                      key={cell.iso}
                      title={
                        isLeave
                          ? `${formatIndianDate(cell.iso)} — ${cell.status?.reason}`
                          : `${formatIndianDate(cell.iso)} — Working Bank Day`
                      }
                      className={`h-9 rounded border flex flex-col items-center justify-center font-mono-num text-xs ${
                        isLeave
                          ? 'bg-[#DC2626]/10 border-[#DC2626]/30 text-[#DC2626] font-semibold'
                          : isToday
                          ? 'bg-[#102A43] border-[#102A43] text-[#14B8A6] font-bold'
                          : 'bg-white border-[#D9E2EC] text-[#243B53]'
                      }`}
                    >
                      <span>{cell.dayNum}</span>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#627D98]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-[#DC2626]/10 border border-[#DC2626]/30 inline-block" />
                  Bank Leave (Sunday / 2nd &amp; 4th Sat / Holiday)
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-xs bg-[#102A43] inline-block" />
                  Today
                </span>
              </div>
            </div>

            {/* Configured Holidays List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-semibold text-[#102A43]">
                  Configured Bank Holidays ({sortedHolidays.length})
                </h3>
                <div className="relative w-56">
                  <Search className="w-3.5 h-3.5 text-[#627D98] absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter holidays..."
                    className="w-full pl-8 pr-2.5 py-1 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>

              <div className="border border-[#D9E2EC] rounded-lg divide-y divide-[#D9E2EC] max-h-72 overflow-y-auto">
                {sortedHolidays.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#627D98]">
                    No bank holidays match your filter.
                  </div>
                ) : (
                  sortedHolidays.map((hol) => (
                    <div
                      key={hol.id}
                      className="px-4 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-[#F4F7FA] transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono-num font-semibold text-[#102A43] whitespace-nowrap">
                          {formatIndianDate(hol.date)}
                        </span>
                        <span className="font-medium text-[#243B53] truncate">
                          {hol.name}
                        </span>
                        <span
                          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ${
                            hol.category === 'Tamil Nadu'
                              ? 'bg-[#F59E0B]/10 text-[#B45309] border-[#F59E0B]/35'
                              : hol.category === 'National'
                              ? 'bg-[#F4F7FA] text-[#243B53] border-[#D9E2EC]'
                              : 'bg-[#176B87]/10 text-[#176B87] border-[#176B87]/30'
                          }`}
                        >
                          {hol.category}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => onDeleteHoliday(hol.id)}
                        title="Remove holiday"
                        className="p-1 text-[#627D98] hover:text-[#DC2626] rounded hover:bg-[#DC2626]/10 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
