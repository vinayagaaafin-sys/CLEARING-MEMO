import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  FileImage,
  Send,
  X,
} from 'lucide-react';
import { getDocumentBlob } from '../services/documentBlobStore';
import {
  BankHoliday,
  CompanyBankAccount,
  CustomerChequeSchedule,
  ScheduleScanDocument,
  ScheduledChequeItem,
} from '../types/treasury';
import {
  addDaysIso,
  isBankHolidayDate,
  toIsoDate,
} from '../utils/bankHolidays';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';

export type DepositQuickFilter = 'today' | 'tomorrow' | 'next7' | 'overdue' | 'custom';

export interface SendToClearingSelection {
  scheduleId: string;
  scheduledChequeId: string;
}

interface DailyDepositScheduleWidgetProps {
  schedules: CustomerChequeSchedule[];
  bankAccounts: CompanyBankAccount[];
  holidays: BankHoliday[];
  onSendToClearingBatch: (
    selections: SendToClearingSelection[],
    depositDate: string,
    companyBankAccountId: string
  ) => void;
  onNavigateSchedules?: () => void;
  compactHeader?: boolean;
}

interface DueChequeRow {
  schedule: CustomerChequeSchedule;
  cheque: ScheduledChequeItem;
  primaryScan?: ScheduleScanDocument;
  holidayWarning?: string;
}

export function DailyDepositScheduleWidget({
  schedules,
  bankAccounts,
  holidays,
  onSendToClearingBatch,
  onNavigateSchedules,
}: DailyDepositScheduleWidgetProps) {
  const todayIso = toIsoDate(new Date());
  const tomorrowIso = addDaysIso(todayIso, 1);
  const next7EndIso = addDaysIso(todayIso, 7);

  const [filterTab, setFilterTab] = useState<DepositQuickFilter>('today');
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [targetBankId, setTargetBankId] = useState<string>(
    bankAccounts.find((b) => b.isDefault)?.id || bankAccounts[0]?.id || ''
  );
  const [sentNotice, setSentNotice] = useState<string | null>(null);
  const [lightboxScan, setLightboxScan] = useState<{
    doc: ScheduleScanDocument;
    url: string;
  } | null>(null);

  const allScheduledRows: DueChequeRow[] = useMemo(() => {
    const rows: DueChequeRow[] = [];
    for (const sch of schedules) {
      const primaryScan = sch.scannedDocuments?.[0];
      for (const chq of sch.cheques || []) {
        if (chq.status !== 'Scheduled') continue;
        const holCheck = isBankHolidayDate(chq.effectiveDate, holidays);
        rows.push({
          schedule: sch,
          cheque: chq,
          primaryScan,
          holidayWarning: holCheck.isHoliday
            ? `Bank Leave: ${holCheck.reason}`
            : undefined,
        });
      }
    }
    return rows.sort((a, b) =>
      a.cheque.effectiveDate.localeCompare(b.cheque.effectiveDate)
    );
  }, [schedules, holidays]);

  const counts = useMemo(() => {
    let today = 0;
    let tomorrow = 0;
    let next7 = 0;
    let overdue = 0;
    for (const r of allScheduledRows) {
      const d = r.cheque.effectiveDate;
      if (d === todayIso) today += 1;
      if (d === tomorrowIso) tomorrow += 1;
      if (d >= todayIso && d <= next7EndIso) next7 += 1;
      if (d < todayIso) overdue += 1;
    }
    return { today, tomorrow, next7, overdue };
  }, [allScheduledRows, todayIso, tomorrowIso, next7EndIso]);

  const filteredRows = useMemo(() => {
    return allScheduledRows.filter((r) => {
      const d = r.cheque.effectiveDate;
      if (filterTab === 'today') return d === todayIso;
      if (filterTab === 'tomorrow') return d === tomorrowIso;
      if (filterTab === 'next7') return d >= todayIso && d <= next7EndIso;
      if (filterTab === 'overdue') return d < todayIso;
      return d === selectedDate;
    });
  }, [
    allScheduledRows,
    filterTab,
    selectedDate,
    todayIso,
    tomorrowIso,
    next7EndIso,
  ]);

  const filteredTotalAmount = useMemo(
    () => filteredRows.reduce((sum, r) => sum + (r.cheque.amount || 0), 0),
    [filteredRows]
  );

  const rowKey = (r: DueChequeRow) => `${r.schedule.id}::${r.cheque.id}`;

  const allSelected =
    filteredRows.length > 0 &&
    filteredRows.every((r) => selectedKeys.includes(rowKey(r)));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedKeys([]);
    } else {
      setSelectedKeys(filteredRows.map(rowKey));
    }
  };

  const toggleOne = (key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSendRows = (rowsToSend: DueChequeRow[]) => {
    if (rowsToSend.length === 0) return;
    const depositDate =
      filterTab === 'tomorrow'
        ? tomorrowIso
        : filterTab === 'custom'
        ? selectedDate
        : todayIso;
    const effectiveBankId =
      targetBankId ||
      rowsToSend[0].schedule.companyBankAccountId ||
      bankAccounts[0]?.id ||
      '';

    onSendToClearingBatch(
      rowsToSend.map((r) => ({
        scheduleId: r.schedule.id,
        scheduledChequeId: r.cheque.id,
      })),
      depositDate,
      effectiveBankId
    );

    const sentSet = new Set(rowsToSend.map(rowKey));
    setSelectedKeys((prev) => prev.filter((k) => !sentSet.has(k)));
    setSentNotice(
      `Moved ${rowsToSend.length} scheduled cheque${rowsToSend.length === 1 ? '' : 's'} into Clearing Batch for ${formatIndianDate(depositDate)}.`
    );
    setTimeout(() => setSentNotice(null), 6000);
  };

  const handlePreviewThumbnail = async (doc: ScheduleScanDocument) => {
    const blob = await getDocumentBlob(doc.id);
    if (blob) {
      const url = URL.createObjectURL(blob);
      setLightboxScan({ doc, url });
    } else if (doc.thumbnailDataUrl) {
      setLightboxScan({ doc, url: doc.thumbnailDataUrl });
    }
  };

  const selectedRows = filteredRows.filter((r) =>
    selectedKeys.includes(rowKey(r))
  );

  return (
    <section
      aria-label="Today's Deposit Schedule"
      className="bg-white border border-[#D9E2EC] rounded-lg overflow-hidden shadow-xs"
    >
      <div className="px-5 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-md bg-[#102A43] border border-[#D4AF37]/50 text-[#14B8A6] flex items-center justify-center shrink-0">
            <CalendarClock className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-[#102A43]">
                Today&apos;s Cheques to Deposit (Scheduled PDC / EMI Queue)
              </h2>
              {counts.overdue > 0 && (
                <span className="text-[11px] font-semibold text-[#DC2626] font-mono-num">
                  · {counts.overdue} Overdue
                </span>
              )}
            </div>
            <p className="text-xs text-[#627D98] mt-0.5">
              Auto-filtered by working bank deposit date ({filteredRows.length} due ·{' '}
              <strong className="font-mono-num text-[#102A43]">
                {formatINR(filteredTotalAmount)}
              </strong>
              ). Send due cheques straight into a Clearing Batch.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* Quick Tabs */}
          <div className="inline-flex p-0.5 bg-white border border-[#D9E2EC] rounded-md">
            {(
              [
                { id: 'today', label: `Today (${counts.today})` },
                { id: 'tomorrow', label: `Tomorrow (${counts.tomorrow})` },
                { id: 'next7', label: `Next 7 Days (${counts.next7})` },
                { id: 'overdue', label: `Overdue / Missed (${counts.overdue})` },
              ] as { id: DepositQuickFilter; label: string }[]
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setFilterTab(tab.id);
                  if (tab.id === 'today') setSelectedDate(todayIso);
                  if (tab.id === 'tomorrow') setSelectedDate(tomorrowIso);
                  setSelectedKeys([]);
                }}
                className={`px-2.5 py-1.5 text-xs rounded transition-colors whitespace-nowrap shrink-0 ${
                  filterTab === tab.id
                    ? 'bg-[#102A43] text-white font-semibold shadow-2xs'
                    : tab.id === 'overdue' && counts.overdue > 0
                    ? 'font-medium text-[#DC2626] hover:bg-[#DC2626]/5'
                    : 'font-medium text-[#627D98] hover:text-[#102A43]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Date Picker */}
          <input
            type="date"
            aria-label="Filter scheduled cheques by deposit date"
            value={selectedDate}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedDate(val);
              if (val === todayIso) setFilterTab('today');
              else if (val === tomorrowIso) setFilterTab('tomorrow');
              else setFilterTab('custom');
              setSelectedKeys([]);
            }}
            className="px-2.5 py-1.5 text-xs font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
          />

          {onNavigateSchedules && (
            <button
              type="button"
              onClick={onNavigateSchedules}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] whitespace-nowrap shrink-0 transition-colors"
            >
              <span>Manage Schedules</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {sentNotice && (
        <div
          role="status"
          className="px-5 py-2.5 bg-[#16A34A]/10 border-b border-[#16A34A]/30 text-xs text-[#102A43] flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>{sentNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSentNotice(null)}
            className="p-0.5 text-[#16A34A] hover:text-[#102A43]"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Bulk Action Strip when items exist */}
      {filteredRows.length > 0 && (
        <div className="px-5 py-2.5 border-b border-[#D9E2EC] bg-white flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[#627D98]">
              Deposit Bank Account:
            </span>
            {bankAccounts.length > 0 ? (
              <select
                value={targetBankId}
                onChange={(e) => setTargetBankId(e.target.value)}
                className="px-2.5 py-1 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              >
                {bankAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.bankName} ({acc.accountNumber})
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[#B45309] font-medium">
                No company bank account configured yet (will create batch with default placeholder)
              </span>
            )}
          </div>

          <button
            type="button"
            disabled={selectedRows.length === 0}
            onClick={() => handleSendRows(selectedRows)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] disabled:opacity-45 transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              Send Selected to Clearing Batch
              {selectedRows.length > 0 ? ` (${selectedRows.length})` : ''}
            </span>
          </button>
        </div>
      )}

      {/* Due Cheques Table */}
      {filteredRows.length === 0 ? (
        <div className="py-8 px-5 text-center space-y-1">
          <p className="text-xs font-medium text-[#243B53]">
            No scheduled PDC/EMI cheques due for deposit in this date view.
          </p>
          <p className="text-[11px] text-[#627D98]">
            {allScheduledRows.length > 0
              ? `You have ${allScheduledRows.length} upcoming scheduled cheque(s). Switch to Next 7 Days or pick a date above.`
              : 'Add a Customer Cheque Schedule with auto-generated or manual PDC dates to see daily deposit queues here.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#D9E2EC] bg-[#F4F7FA] text-[11px] font-semibold text-[#627D98]">
                <th className="py-2.5 pl-5 pr-2 w-9">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleSelectAll}
                    aria-label="Select all due cheques"
                    className="rounded border-[#D9E2EC] text-[#14B8A6] accent-[#14B8A6] focus:ring-[#14B8A6]"
                  />
                </th>
                <th className="py-2.5 px-3">Deposit Date</th>
                <th className="py-2.5 px-3">Customer / Party</th>
                <th className="py-2.5 px-3">Loan / Ref No</th>
                <th className="py-2.5 px-3">Cheque #</th>
                <th className="py-2.5 px-3">Drawee Bank</th>
                <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                <th className="py-2.5 px-3 text-center">Scan</th>
                <th className="py-2.5 pl-3 pr-5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#D9E2EC] text-xs">
              {filteredRows.map((row) => {
                const key = rowKey(row);
                const checked = selectedKeys.includes(key);
                const wasShifted =
                  row.cheque.effectiveDate !== row.cheque.originalDate;
                return (
                  <tr
                    key={key}
                    className="hover:bg-[#F4F7FA]/80 transition-colors"
                  >
                    <td className="py-2.5 pl-5 pr-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(key)}
                        aria-label={`Select cheque ${row.cheque.chequeNumber}`}
                        className="rounded border-[#D9E2EC] text-[#14B8A6] accent-[#14B8A6] focus:ring-[#14B8A6]"
                      />
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-mono-num font-semibold text-[#102A43]">
                        {formatIndianDate(row.cheque.effectiveDate)}
                      </div>
                      {wasShifted && row.cheque.shiftReason && (
                        <div className="text-[10px] font-medium text-[#B45309]">
                          {row.cheque.shiftReason}
                        </div>
                      )}
                      {row.holidayWarning && (
                        <div className="text-[10px] font-medium text-[#DC2626] inline-flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          <span>{row.holidayWarning}</span>
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-medium text-[#102A43]">
                      {row.schedule.customerName}
                    </td>
                    <td className="py-2.5 px-3 font-mono-num text-[#243B53]">
                      {row.schedule.loanRefNo || '—'}
                    </td>
                    <td className="py-2.5 px-3 font-mono-num font-bold text-[#102A43]">
                      {row.cheque.chequeNumber}
                    </td>
                    <td className="py-2.5 px-3 text-[#243B53]">
                      <div>{row.schedule.draweeBank || '—'}</div>
                      {row.schedule.draweeBranch && (
                        <div className="text-[10px] text-[#627D98]">
                          {row.schedule.draweeBranch}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-[#102A43] whitespace-nowrap">
                      {formatINR(row.cheque.amount)}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      {row.primaryScan?.thumbnailDataUrl ? (
                        <button
                          type="button"
                          onClick={() =>
                            void handlePreviewThumbnail(row.primaryScan!)
                          }
                          title={`View attached scan: ${row.primaryScan.fileName}`}
                          className="inline-block border border-[#D9E2EC] rounded overflow-hidden hover:border-[#14B8A6] transition-colors"
                        >
                          <img
                            src={row.primaryScan.thumbnailDataUrl}
                            alt={row.primaryScan.fileName}
                            className="w-10 h-7 object-cover block"
                          />
                        </button>
                      ) : row.primaryScan ? (
                        <button
                          type="button"
                          onClick={() =>
                            void handlePreviewThumbnail(row.primaryScan!)
                          }
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#176B87] hover:text-[#102A43]"
                        >
                          <FileImage className="w-3.5 h-3.5" />
                          <span>PDF</span>
                        </button>
                      ) : (
                        <span className="text-[#627D98]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 pl-3 pr-5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleSendRows([row])}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-[#102A43] bg-[#14B8A6] rounded hover:bg-[#0D9488] transition-colors whitespace-nowrap"
                      >
                        <Send className="w-3 h-3" aria-hidden="true" />
                        <span>Send to Clearing Batch</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Read-only Scan Lightbox */}
      {lightboxScan && (
        <div
          className="fixed inset-0 z-50 bg-[#102A43]/75 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-[#D9E2EC] rounded-lg max-w-2xl w-full overflow-hidden shadow-xl">
            <div className="px-4 py-3 border-b border-[#D9E2EC] bg-[#F4F7FA] flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-[#102A43] truncate">
                {lightboxScan.doc.label || 'Attached Scan'} —{' '}
                <span className="font-mono-num text-[#627D98]">
                  {lightboxScan.doc.fileName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setLightboxScan(null)}
                className="p-1 text-[#627D98] hover:text-[#102A43]"
                aria-label="Close preview"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-[#102A43] p-4 flex items-center justify-center max-h-[75vh] overflow-auto">
              {lightboxScan.doc.mimeType === 'application/pdf' ? (
                <iframe
                  title={lightboxScan.doc.fileName}
                  src={lightboxScan.url}
                  className="w-full h-[65vh] bg-white rounded"
                />
              ) : (
                <img
                  src={lightboxScan.url}
                  alt={lightboxScan.doc.fileName}
                  className="max-h-[68vh] w-auto object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
