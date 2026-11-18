import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Lock,
  Upload,
  X,
} from 'lucide-react';
import { BOUNCE_REASONS } from '../data/indianBanks';
import { ChequeEntry, ClearingBatch } from '../types/treasury';
import { formatIndianDate, formatINR } from '../utils/indianCurrency';
import {
  downloadSampleBankStatementCSV,
  parseAndReconcileBankStatement,
  StatementParseResult,
} from '../utils/statementParser';

export interface ReconcileConfirmItem {
  chequeId: string;
  returnReason: string;
  bouncedDate: string;
}

interface BankStatementReconcileModalProps {
  cheques: ChequeEntry[];
  batches: ClearingBatch[];
  onConfirmReconcile: (
    updates: ReconcileConfirmItem[],
    fileName: string
  ) => void;
  onClose: () => void;
}

const CUSTOM_OPTION = '__CUSTOM__';

export function BankStatementReconcileModal({
  cheques,
  batches,
  onConfirmReconcile,
  onClose,
}: BankStatementReconcileModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<StatementParseResult | null>(null);

  // Editable per-match selection, reason, and return date
  const [selectedMap, setSelectedMap] = useState<Record<string, boolean>>({});
  const [reasonMap, setReasonMap] = useState<Record<string, string>>({});
  const [dateMap, setDateMap] = useState<Record<string, string>>({});

  const processFile = async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    try {
      const parsed = await parseAndReconcileBankStatement(file, cheques, batches);
      setResult(parsed);

      const nextSelected: Record<string, boolean> = {};
      const nextReasons: Record<string, string> = {};
      const nextDates: Record<string, string> = {};
      for (const item of parsed.matchedCandidates) {
        nextSelected[item.id] = true;
        nextReasons[item.id] = item.detectedReason;
        nextDates[item.id] = item.statementDate;
      }
      setSelectedMap(nextSelected);
      setReasonMap(nextReasons);
      setDateMap(nextDates);
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

  const selectedCandidates = result
    ? result.matchedCandidates.filter((item) => selectedMap[item.id])
    : [];

  const handleConfirm = () => {
    if (!result || selectedCandidates.length === 0) return;
    const payload: ReconcileConfirmItem[] = selectedCandidates.map((item) => ({
      chequeId: item.cheque.id,
      returnReason:
        (reasonMap[item.id] || '').trim() || 'Cheque Returned (Bank Statement)',
      bouncedDate: dateMap[item.id] || new Date().toISOString().slice(0, 10),
    }));
    onConfirmReconcile(payload, result.fileName);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reconcile-modal-title"
    >
      <div className="w-full max-w-5xl max-h-[90vh] flex flex-col bg-white border border-slate-200 rounded-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="w-5 h-5 text-slate-900" aria-hidden="true" />
            <div>
              <h3
                id="reconcile-modal-title"
                className="text-base font-semibold text-slate-900"
              >
                Bank Statement Auto-Reconciliation (Returned Cheques)
              </h3>
              <p className="text-xs text-slate-500">
                Upload Excel (.xlsx, .xls), CSV (.csv), or PDF (.pdf) bank statements to detect returned/bounced cheques and preview status updates
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
                      ? 'Scanning bank statement transactions...'
                      : result
                      ? `Loaded: ${result.fileName}`
                      : 'Drag & drop your bank statement file here, or click Browse'}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Supports .xlsx, .xls, .csv, and .pdf · Scans for CHQ RET, BOUNCE, UNPAID, INSUFFICIENT FUNDS, PAYMENT STOPPED, SIGN MISMATCH, STALE, etc.
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => downloadSampleBankStatementCSV(cheques)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Sample CSV</span>
                </button>
                <button
                  type="button"
                  disabled={isParsing}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{result ? 'Upload Another File' : 'Select Statement File'}</span>
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
              {/* Parse Summary Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-slate-500">Statement Rows Parsed</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-900">
                    {result.totalRowsParsed} ({result.fileType})
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-slate-500">Return Entries Detected</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-amber-700">
                    {result.returnRowsDetected}
                  </div>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                  <div className="text-emerald-800">Matched Ledger Cheques</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-emerald-900">
                    {result.matchedCandidates.length}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-slate-500">Unmatched Return Lines</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-700">
                    {result.unmatchedReturnRows.length}
                  </div>
                </div>
              </div>

              {/* Matched Cheques Confirmation Table */}
              {result.matchedCandidates.length === 0 ? (
                <div className="p-8 border border-slate-200 rounded-md text-center space-y-1.5">
                  <p className="text-sm font-medium text-slate-900">
                    No matching returned cheques found in this statement
                  </p>
                  <p className="text-xs text-slate-500 max-w-lg mx-auto">
                    {result.returnRowsDetected === 0
                      ? 'No transaction descriptions matched return keywords (CHQ RET, BOUNCE, UNPAID, INSUFFICIENT FUNDS, etc.).'
                      : 'Return entries were detected, but their 6-digit cheque numbers did not match any cheques stored in the active company.'}
                  </p>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-md overflow-hidden">
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-900">
                      Preview &amp; Confirm Matched Returned Cheques ({selectedCandidates.length} of{' '}
                      {result.matchedCandidates.length} selected)
                    </span>
                    <span className="text-[11px] text-slate-500">
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
                              aria-label="Toggle all matched cheques"
                              checked={
                                result.matchedCandidates.length > 0 &&
                                result.matchedCandidates.every((m) => selectedMap[m.id])
                              }
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const next: Record<string, boolean> = {};
                                result.matchedCandidates.forEach((m) => {
                                  next[m.id] = checked;
                                });
                                setSelectedMap(next);
                              }}
                              className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
                            />
                          </th>
                          <th className="py-2.5 px-3">Cheque Number</th>
                          <th className="py-2.5 px-3">Batch Name</th>
                          <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                          <th className="py-2.5 px-3">Return Date</th>
                          <th className="py-2.5 px-3 min-w-[300px]">
                            Detected Return Reason (Editable)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {result.matchedCandidates.map((item) => {
                          const currentReason = reasonMap[item.id] ?? '';
                          const isPreset = BOUNCE_REASONS.includes(currentReason);
                          const isSelected = Boolean(selectedMap[item.id]);

                          return (
                            <tr
                              key={item.id}
                              className={!isSelected ? 'opacity-50 bg-slate-50/50' : 'bg-white'}
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
                                  Chq Date: {formatIndianDate(item.cheque.chequeDate)}
                                </div>
                              </td>
                              <td className="py-3 px-3 align-top">
                                <div className="font-mono-num font-medium text-slate-900 flex items-center gap-1.5">
                                  <span>{item.batchName}</span>
                                  {item.isBatchLocked && (
                                    <span
                                      title="Batch is locked — Status and Return Reason update cleanly without unlocking"
                                      className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-amber-700"
                                    >
                                      <Lock className="w-3 h-3" aria-hidden="true" />
                                      <span>Locked</span>
                                    </span>
                                  )}
                                </div>
                                <div
                                  className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[180px]"
                                  title={item.statementNarration}
                                >
                                  {item.statementNarration}
                                </div>
                              </td>
                              <td className="py-3 px-3 align-top text-right whitespace-nowrap">
                                <div className="font-mono-num font-semibold text-slate-900">
                                  {formatINR(item.cheque.amount)}
                                </div>
                                {item.statementAmount > 0 && (
                                  <div
                                    className={`text-[10px] font-mono-num ${
                                      item.amountMatches
                                        ? 'text-emerald-700'
                                        : 'text-amber-700 font-semibold'
                                    }`}
                                  >
                                    {item.amountMatches
                                      ? 'Amount matched'
                                      : `Stmt: ${formatINR(item.statementAmount)}`}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3 align-top">
                                <input
                                  type="date"
                                  value={dateMap[item.id] || item.statementDate}
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
                                  value={isPreset ? currentReason : CUSTOM_OPTION}
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

              {/* Unmatched return rows summary */}
              {result.unmatchedReturnRows.length > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-950 space-y-1.5">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
                    <span>
                      {result.unmatchedReturnRows.length} return statement line(s) could not be matched to a cheque in this company
                    </span>
                  </div>
                  <ul className="list-disc pl-5 text-[11px] text-amber-900 space-y-0.5">
                    {result.unmatchedReturnRows.slice(0, 5).map((u) => (
                      <li key={u.rowIndex}>
                        Row {u.rowIndex}:{' '}
                        {u.chequeNumber ? `Chq #${u.chequeNumber}` : 'No 6-digit Chq #'} —{' '}
                        {u.narration.slice(0, 90)}
                        {u.narration.length > 90 ? '...' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
          <div className="text-xs text-slate-500">
            {result
              ? `Ready to mark ${selectedCandidates.length} cheque(s) as Returned / Bounced.`
              : 'Select an Excel, CSV, or PDF bank statement to start matching.'}
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
              disabled={!result || selectedCandidates.length === 0}
              onClick={handleConfirm}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                Confirm &amp; Update {selectedCandidates.length} Cheque
                {selectedCandidates.length === 1 ? '' : 's'} to Returned
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
