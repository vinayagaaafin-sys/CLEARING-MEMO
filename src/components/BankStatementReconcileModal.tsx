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
  matchType: 'CLEARED' | 'RETURNED';
  targetStatus: 'Cleared' | 'Returned / Bounced';
  returnReason: string;
  bouncedDate: string;
  clearedDate?: string;
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

  const processFile = async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    try {
      const parsed = await parseAndReconcileBankStatement(file, cheques, batches);
      console.log('PARSE RESULT:', {
        cleared: parsed.clearedMatches,
        returned: parsed.returnedMatches,
      });
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
    const targetRow = result.unmatchedReturnRows.find((u) => u.rowIndex === rowIndex);
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
      detectedReason: targetRow.detectedReason || 'Cheque Returned (Manual Review)',
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

  const totalSelectedCount =
    selectedReturnedCandidates.length + selectedClearedCandidates.length;

  const handleConfirm = () => {
    if (!result || totalSelectedCount === 0) return;
    const today = new Date().toISOString().slice(0, 10);

    const returnedPayload: ReconcileConfirmItem[] = selectedReturnedCandidates.map(
      (item) => ({
        chequeId: item.cheque.id,
        matchType: 'RETURNED',
        targetStatus: 'Returned / Bounced',
        returnReason:
          (reasonMap[item.id] || '').trim() || 'Cheque Returned (Bank Statement)',
        bouncedDate: dateMap[item.id] || today,
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
      }));

    onConfirmReconcile([...clearedPayload, ...returnedPayload], result.fileName);
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
                Bank Statement Auto-Reconciliation (Cleared &amp; Returned Cheques)
              </h3>
              <p className="text-xs text-slate-500">
                Upload Excel (.xlsx, .xls), CSV (.csv), or PDF (.pdf) bank statements to auto-detect cleared/passed and returned/bounced cheques
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
                    Supports .xlsx, .xls, .csv, and .pdf · Detects clearing entries (BY CLG, OW CLG, CTS, CHQ PAID) &amp; return entries (CHQ RET, REJECT, BOUNCE, INSUFF FUNDS)
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
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md">
                  <div className="text-emerald-800">Cleared / Passed Cheques</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-emerald-900">
                    {result.clearedMatches.length}
                  </div>
                </div>
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <div className="text-red-800">Returned / Bounced Cheques</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-red-900">
                    {result.returnedMatches.length}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-md">
                  <div className="text-slate-500">Unmatched Return Lines</div>
                  <div className="mt-1 text-base font-bold font-mono-num text-slate-700">
                    {result.unmatchedReturnRows.length}
                  </div>
                </div>
              </div>

              {/* Empty Match State */}
              {result.clearedMatches.length === 0 &&
                result.returnedMatches.length === 0 && (
                  <div className="p-8 border border-slate-200 rounded-md text-center space-y-1.5">
                    <p className="text-sm font-medium text-slate-900">
                      No matching cleared or returned cheques found in this statement
                    </p>
                    <p className="text-xs text-slate-500 max-w-lg mx-auto">
                      {result.returnRowsDetected === 0
                        ? 'No statement transactions matched stored cheque numbers and amounts in the active company.'
                        : 'Return entries were detected, but no stored cheques in the active company matched any extracted candidate cheque number or last-4 digits with matching amount (< ₹0.01 difference). See unmatched diagnostics below.'}
                    </p>
                  </div>
                )}

              {/* Cleared Cheques Confirmation Table */}
              {result.clearedMatches.length > 0 && (
                <div className="border border-emerald-200 rounded-md overflow-hidden">
                  <div className="px-4 py-2.5 bg-emerald-50/70 border-b border-emerald-200 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-emerald-950">
                        Cleared / Passed Cheques ({selectedClearedCandidates.length} of{' '}
                        {result.clearedMatches.length} selected)
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300">
                        Passed / Cleared
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
                          <th className="py-2.5 px-3">Matched Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {result.clearedMatches.map((item) => {
                          const isSelected = Boolean(clearedSelectedMap[item.id]);
                          return (
                            <tr
                              key={item.id}
                              className={!isSelected ? 'opacity-50 bg-slate-50/50' : 'bg-white'}
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
                                  Chq Date: {formatIndianDate(item.cheque.chequeDate)}
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
                              <td className="py-3 px-3 align-top max-w-[300px]">
                                <div className="font-mono-num font-medium text-slate-900 flex items-center gap-1.5">
                                  <span>{item.batchName}</span>
                                  {item.isBatchLocked && (
                                    <span
                                      title="Batch is locked — Status updates cleanly without unlocking"
                                      className="inline-flex items-center gap-0.5 text-[10px] font-sans font-semibold text-amber-700"
                                    >
                                      <Lock className="w-3 h-3" aria-hidden="true" />
                                      <span>Locked</span>
                                    </span>
                                  )}
                                </div>
                                <div className="mt-1.5 flex items-start gap-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                                  <span
                                    className={`inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono-num font-bold border ${
                                      item.txnDirection === 'CR' || item.isCredit
                                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                        : item.txnDirection === 'DR'
                                        ? 'bg-amber-100 text-amber-900 border-amber-300'
                                        : 'bg-slate-100 text-slate-700 border-slate-300'
                                    }`}
                                  >
                                    {item.txnDirection || (item.isCredit ? 'CR' : 'DR/AMT')}
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
                                  value={clearedDateMap[item.id] || item.statementDate}
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
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-900 border border-emerald-300">
                                  Passed / Cleared
                                </span>
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

              {/* Matched Returned Cheques Confirmation Table */}
              {result.returnedMatches.length > 0 && (
                <div className="border border-red-200 rounded-md overflow-hidden">
                  <div className="px-4 py-2.5 bg-red-50/70 border-b border-red-200 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-red-950">
                        Returned / Bounced Cheques ({selectedReturnedCandidates.length} of{' '}
                        {result.returnedMatches.length} selected)
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-900 border border-red-300">
                        Returned
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
                                result.returnedMatches.every((m) => selectedMap[m.id])
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
                          <th className="py-2.5 px-3">Batch Name</th>
                          <th className="py-2.5 px-3 text-right">Amount (₹)</th>
                          <th className="py-2.5 px-3">Return Date</th>
                          <th className="py-2.5 px-3 min-w-[300px]">
                            Detected Return Reason (Editable)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {result.returnedMatches.map((item) => {
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
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono-num font-bold text-slate-900">
                                    #{item.cheque.chequeNumber}
                                  </span>
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-red-100 text-red-900 border border-red-200">
                                    Returned
                                  </span>
                                </div>
                                <div className="text-[11px] text-slate-600 truncate max-w-[175px]">
                                  {item.cheque.partyName}
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  Chq Date: {formatIndianDate(item.cheque.chequeDate)}
                                </div>
                                {item.matchMethod === 'LAST_4' && (
                                  <div className="text-[10px] text-slate-500 font-mono-num mt-0.5">
                                    Last-4 match ({item.matchedStatementNumber})
                                  </div>
                                )}
                                {item.matchMethod === 'STMT_XREF' && (
                                  <div className="text-[10px] text-sky-700 font-medium mt-0.5">
                                    Statement cross-ref match
                                  </div>
                                )}
                                {item.matchMethod === 'AMOUNT_UNIQUE' && (
                                  <div className="text-[10px] text-sky-700 font-medium mt-0.5">
                                    Unique amount match (no Chq # in line)
                                  </div>
                                )}
                                {item.matchMethod === 'MANUAL' && (
                                  <div className="text-[10px] text-amber-700 font-medium mt-0.5">
                                    Manual review assignment
                                  </div>
                                )}
                                {item.hasPassedAndReturnedPair && (
                                  <div className="text-[10px] text-red-700 font-medium mt-0.5">
                                    Passed + Returned pair → Final: Returned
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3 align-top max-w-[280px]">
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
                                <div className="mt-1.5 flex items-start gap-1.5 bg-red-50/50 border border-red-200/80 rounded px-2 py-1">
                                  <span
                                    className={`inline-flex items-center shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono-num font-bold border ${
                                      item.txnDirection === 'CR' || item.isCredit
                                        ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                                        : item.txnDirection === 'DR'
                                        ? 'bg-red-100 text-red-900 border-red-300'
                                        : 'bg-slate-100 text-slate-700 border-slate-300'
                                    }`}
                                  >
                                    {item.txnDirection || (item.isCredit ? 'CR' : 'DR/AMT')}
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
                                {item.associatedChargeAmount && item.associatedChargeAmount > 0 && (
                                  <div className="text-[10px] font-mono-num text-slate-500">
                                    Bank Chg ignored: {formatINR(item.associatedChargeAmount)}
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

              {/* Bank Return Charges & Deduplicated Entries Log */}
              {(result.ignoredChargeRows.length > 0 ||
                result.ignoredDuplicateRows.length > 0) && (
                <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-md text-xs text-slate-700 space-y-1.5">
                  <div className="font-semibold text-slate-900">
                    Separated Bank Return Charges &amp; Duplicate Lines (
                    {result.ignoredChargeRows.length} charge
                    {result.ignoredChargeRows.length === 1 ? '' : 's'},{' '}
                    {result.ignoredDuplicateRows.length} duplicate
                    {result.ignoredDuplicateRows.length === 1 ? '' : 's'} ignored)
                  </div>
                  <ul className="list-disc pl-5 text-[11px] text-slate-600 space-y-0.5">
                    {result.ignoredChargeRows.slice(0, 5).map((chg) => (
                      <li key={`chg-${chg.rowIndex}`}>
                        Row {chg.rowIndex} (Bank Return Charge):{' '}
                        {chg.chequeNumber ? `Chq #${chg.chequeNumber}` : 'Charge entry'}
                        {chg.amount > 0 ? ` · ${formatINR(chg.amount)}` : ''} —{' '}
                        {chg.narration.slice(0, 80)}
                        {chg.narration.length > 80 ? '...' : ''}
                      </li>
                    ))}
                    {result.ignoredDuplicateRows.slice(0, 3).map((dup) => (
                      <li key={`dup-${dup.rowIndex}`}>
                        Row {dup.rowIndex} (Duplicate / Superseded Entry):{' '}
                        {dup.chequeNumber ? `Chq #${dup.chequeNumber}` : 'Entry'} —{' '}
                        {dup.narration.slice(0, 80)}
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
                      {result.unmatchedReturnRows.length} return statement line(s) could not be matched to a cheque in this company
                    </span>
                  </div>
                  <ul className="list-disc pl-5 text-[11px] text-amber-900 space-y-2">
                    {result.unmatchedReturnRows.slice(0, 5).map((u) => (
                      <li key={u.rowIndex} className="space-y-0.5">
                        <div>
                          <span className="font-semibold">Row {u.rowIndex}:</span>{' '}
                          {u.chequeNumber ? `Chq #${u.chequeNumber}` : 'No Chq # detected'}
                          {u.amount > 0 ? ` · ${formatINR(u.amount)}` : ''} —{' '}
                          {u.narration.slice(0, 90)}
                          {u.narration.length > 90 ? '...' : ''}
                        </div>
                        {u.debugInfo && (
                          <div className="text-[10px] text-amber-800/90 font-mono-num pl-1 space-y-1">
                            {u.debugInfo.manualReviewRequired &&
                              u.debugInfo.ambiguousCheques &&
                              u.debugInfo.ambiguousCheques.length > 1 && (
                                <div className="font-sans flex flex-wrap items-center gap-2 py-1">
                                  <span className="font-semibold text-red-800">
                                    Manual Review Required: Multiple cheques match{' '}
                                    {formatINR(u.amount)} — select returned cheque:
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
                                    <option value="">Select matching cheque...</option>
                                    {u.debugInfo.ambiguousCheques.map((ac) => (
                                      <option key={ac.id} value={ac.id}>
                                        #{ac.chequeNumber} · {ac.partyName} ·{' '}
                                        {formatIndianDate(ac.chequeDate)} ({ac.status})
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                            <div>
                              Candidates:{' '}
                              {u.debugInfo.extractedCandidates.length > 0
                                ? u.debugInfo.extractedCandidates
                                    .map((c) => `${c.raw} (pad6: ${c.padded6}, last4: ${c.last4})`)
                                    .join(', ')
                                : 'None'}{' '}
                              · Tx Amt: {formatINR(u.debugInfo.transactionAmount)}
                            </div>
                            {u.debugInfo.closestStoredCheques.length > 0 && (
                              <div>
                                Closest stored:{' '}
                                {u.debugInfo.closestStoredCheques
                                  .map(
                                    (c) =>
                                      `#${c.chequeNumber} (${formatINR(c.amount)}, ${c.mismatchReason})`
                                  )
                                  .join(' | ')}
                              </div>
                            )}
                          </div>
                        )}
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
              ? `Ready to mark ${selectedClearedCandidates.length} cheque(s) Cleared and ${selectedReturnedCandidates.length} cheque(s) Returned.`
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
              disabled={!result || totalSelectedCount === 0}
              onClick={handleConfirm}
              className={`inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-white rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
                selectedReturnedCandidates.length > 0 &&
                selectedClearedCandidates.length === 0
                  ? 'bg-red-700 hover:bg-red-800'
                  : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                Confirm &amp; Update {totalSelectedCount} Cheque
                {totalSelectedCount === 1 ? '' : 's'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
