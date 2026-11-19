import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Layers,
  Printer,
} from 'lucide-react';
import {
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CorporateProfile,
} from '../types/treasury';
import {
  evaluateChequeDate,
  formatIndianDate,
  formatINR,
  numberToIndianWords,
} from '../utils/indianCurrency';
import {
  generateBankDepositMemoPDF,
  MemoDocumentData,
  paginateMemoCheques,
} from '../utils/pdfMemoGenerator';

interface PrintMemoViewProps {
  profile: CorporateProfile;
  bankAccounts: CompanyBankAccount[];
  batches: ClearingBatch[];
  activeBatchId: string;
  cheques: ChequeEntry[];
}

export function PrintMemoView({
  profile,
  bankAccounts,
  batches,
  activeBatchId,
  cheques,
}: PrintMemoViewProps) {
  const [selectedBatchId, setSelectedBatchId] = useState<string>(activeBatchId);
  const [groupingMode, setGroupingMode] = useState<'consolidated' | 'by-clearing-type'>(
    'by-clearing-type'
  );
  const [excludeComplianceHolds, setExcludeComplianceHolds] = useState(true);
  const [includeClearedToo, setIncludeClearedToo] = useState(true);
  const [simulate55Cheques, setSimulate55Cheques] = useState(false);
  const [pdfDownloadNotice, setPdfDownloadNotice] = useState<{
    filename: string;
    blobUrl: string;
  } | null>(null);
  const [printFallbackHint, setPrintFallbackHint] = useState(false);

  const selectedBatch =
    batches.find((b) => b.id === selectedBatchId) || batches[0];

  const bankMap = useMemo(
    () => new Map(bankAccounts.map((a) => [a.id, a])),
    [bankAccounts]
  );

  // Build candidate cheques (or 55-cheque stress test clone if enabled)
  const { eligibleCheques, excludedHolds } = useMemo(() => {
    const baseBatchCheques = cheques.filter(
      (c) => c.batchId === selectedBatch?.id && c.status !== 'Returned / Bounced'
    );

    const statusFiltered = includeClearedToo
      ? baseBatchCheques
      : baseBatchCheques.filter(
          (c) => c.status === 'Draft' || c.status === 'Submitted to Bank'
        );

    const holds: ChequeEntry[] = [];
    const valid: ChequeEntry[] = [];

    for (const c of statusFiltered) {
      const ev = evaluateChequeDate(
        c.chequeDate,
        selectedBatch?.depositDate || '2026-11-17'
      );
      if (excludeComplianceHolds && ev.flag !== 'VALID') {
        holds.push(c);
      } else {
        valid.push(c);
      }
    }

    if (simulate55Cheques && valid.length > 0) {
      const expanded: ChequeEntry[] = [];
      for (let i = 0; i < 55; i++) {
        const src = valid[i % valid.length];
        const chqNum = String((Number(src.chequeNumber) + i * 13) % 900000 + 100000);
        expanded.push({
          ...src,
          id: `${src.id}-sim-${i}`,
          chequeNumber: chqNum,
        });
      }
      return { eligibleCheques: expanded, excludedHolds: holds };
    }

    return { eligibleCheques: valid, excludedHolds: holds };
  }, [
    cheques,
    selectedBatch,
    excludeComplianceHolds,
    includeClearedToo,
    simulate55Cheques,
  ]);

  // Build separate MemoDocuments per Bank Account + (optionally) Clearing Type
  const memoDocuments: MemoDocumentData[] = useMemo(() => {
    if (!selectedBatch || eligibleCheques.length === 0) return [];

    const groups = new Map<string, ChequeEntry[]>();

    for (const chq of eligibleCheques) {
      const key =
        groupingMode === 'consolidated'
          ? `${chq.companyBankAccountId}__ALL`
          : `${chq.companyBankAccountId}__${chq.clearingType}`;
      const list = groups.get(key) || [];
      list.push(chq);
      groups.set(key, list);
    }

    const docs: MemoDocumentData[] = [];
    groups.forEach((groupCheques, key) => {
      const [accId, cType] = key.split('__');
      const bankAccount = bankMap.get(accId) || bankAccounts[0];
      if (!bankAccount) return;
      docs.push({
        id: key,
        title:
          cType === 'ALL'
            ? 'CONSOLIDATED CHEQUE DEPOSIT MEMO'
            : `${cType.toUpperCase()} DEPOSIT MEMO`,
        clearingLabel: cType === 'ALL' ? 'Consolidated Schedule (All Clearing Types)' : cType,
        bankAccount,
        batch: selectedBatch,
        cheques: groupCheques,
      });
    });

    return docs;
  }, [eligibleCheques, groupingMode, selectedBatch, bankMap, bankAccounts]);

  const handleDownloadPdf = () => {
    if (memoDocuments.length === 0 || !selectedBatch) return;
    if (pdfDownloadNotice?.blobUrl) {
      URL.revokeObjectURL(pdfDownloadNotice.blobUrl);
    }
    const result = generateBankDepositMemoPDF(
      profile,
      memoDocuments,
      selectedBatch.batchRef
    );
    setPdfDownloadNotice(result);
    setPrintFallbackHint(false);
  };

  const handleBrowserPrint = () => {
    const isInIframe = window.self !== window.top;
    window.print();
    if (isInIframe) {
      setPrintFallbackHint(true);
    }
  };

  return (
    <div className="space-y-6">
      {/* Control Toolbar - Hidden when printing */}
      <section className="no-print bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Official Bank Deposit Memo Engine (A4 Print / PDF)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Generates bank-compliant A4 schedules with repeating headers, B/F &amp; C/F subtotals, Indian currency words, and Teller Receipt
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={memoDocuments.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>Save / Download A4 PDF</span>
            </button>

            <button
              type="button"
              onClick={handleBrowserPrint}
              disabled={memoDocuments.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              <span>Browser Print</span>
            </button>
          </div>
        </div>

        {pdfDownloadNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                A4 PDF Memo generated: <strong className="font-mono-num">{pdfDownloadNotice.filename}</strong>
              </span>
            </div>
            <a
              href={pdfDownloadNotice.blobUrl}
              download={pdfDownloadNotice.filename}
              className="font-semibold text-emerald-800 underline hover:text-emerald-950"
            >
              Click here if download didn&apos;t start
            </a>
          </div>
        )}

        {printFallbackHint && (
          <div className="p-3 bg-slate-100 border border-slate-300 rounded-md text-xs text-slate-800">
            Embedded preview frames may block the browser print dialog. Use <strong>Save / Download A4 PDF</strong> above to export the exact A4 PDF file directly.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Clearing Batch
            </label>
            <select
              value={selectedBatch?.id || ''}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono-num font-medium border border-slate-300 rounded-md bg-white"
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.batchRef} ({formatIndianDate(b.depositDate)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Memo Slip Grouping
            </label>
            <div className="flex p-0.5 bg-slate-100 border border-slate-200 rounded-md">
              <button
                type="button"
                onClick={() => setGroupingMode('by-clearing-type')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  groupingMode === 'by-clearing-type'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Separate by Type
              </button>
              <button
                type="button"
                onClick={() => setGroupingMode('consolidated')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  groupingMode === 'consolidated'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Consolidated
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={excludeComplianceHolds}
                onChange={(e) => setExcludeComplianceHolds(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Exclude PDC &amp; Stale Cheques ({excludedHolds.length} held)</span>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={includeClearedToo}
                onChange={(e) => setIncludeClearedToo(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-900"
              />
              <span>Include Already Cleared Cheques</span>
            </label>
          </div>

          <div className="flex items-center justify-start xl:justify-end">
            <button
              type="button"
              onClick={() => setSimulate55Cheques((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                simulate55Cheques
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {simulate55Cheques
                  ? '55-Cheque Multi-Page Preview: ON'
                  : 'Test 55-Cheque Multi-Page Pagination'}
              </span>
            </button>
          </div>
        </div>

        {excludedHolds.length > 0 && excludeComplianceHolds && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-xs text-amber-950 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>
              <strong>Compliance Guard Active:</strong> {excludedHolds.length} Post-Dated / Stale instrument(s) (
              {excludedHolds.map((h) => `#${h.chequeNumber} - ${h.partyName}`).join(', ')}) are automatically held back from the bank deposit memo.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-1">
          <span className="inline-flex items-center gap-1.5 font-medium text-slate-800">
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>
              Generated Memos: {memoDocuments.length} document{memoDocuments.length === 1 ? '' : 's'}
            </span>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Total Instruments in Print Queue:{' '}
            <strong className="font-mono-num text-slate-900">
              {eligibleCheques.length}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Print Tip: In browser print dialog, set Paper Size to <strong>A4</strong> and Margins to <strong>None</strong> (built-in 12mm letterhead margins applied).
          </span>
        </div>
      </section>

      {/* Printable A4 Sheets Area */}
      <div className="print-only-root">
        {memoDocuments.length === 0 ? (
          <div className="no-print bg-white border border-slate-200 rounded-lg p-12 text-center text-sm text-slate-500">
            No eligible cheques found in the selected batch for printing. Adjust your filters or add instruments first.
          </div>
        ) : (
          memoDocuments.map((doc) => {
            const pages = paginateMemoCheques(doc.cheques);
            const grandTotal = doc.cheques.reduce((s, c) => s + c.amount, 0);

            return (
              <div key={doc.id} className="memo-document-group">
                {pages.map((page) => (
                  <article
                    key={`${doc.id}-p${page.pageNumber}`}
                    className="a4-sheet text-slate-900"
                  >
                    {/* TOP CONTENT: Header + Table */}
                    <div>
                      {page.isFirstPage ? (
                        <>
                          {/* Official Corporate Letterhead */}
                          <header className="border-b-2 border-slate-900 pb-3 mb-3 flex items-start justify-between gap-4">
                            <div className="space-y-0.5 max-w-[65%]">
                              <h1 className="text-[15px] font-bold tracking-tight text-slate-950 uppercase">
                                {profile.companyName}
                              </h1>
                              <p className="text-[10px] leading-snug text-slate-700">
                                {profile.registeredAddress}
                              </p>
                              <p className="text-[10px] text-slate-600 font-mono-num">
                                PAN: {profile.pan} &nbsp;|&nbsp; GSTIN: {profile.gstin}
                                {profile.cin ? ` | CIN: ${profile.cin}` : ''}
                              </p>
                            </div>
                            <div className="text-right space-y-0.5 shrink-0">
                              <div className="text-[11px] font-bold tracking-wide text-slate-950 border border-slate-900 px-2 py-0.5 inline-block">
                                {doc.title}
                              </div>
                              <div className="text-[10px] text-slate-700 pt-1">
                                Batch Ref:{' '}
                                <strong className="font-mono-num text-slate-950">
                                  {doc.batch.batchRef}
                                </strong>
                              </div>
                              <div className="text-[10px] text-slate-700">
                                Deposit Date:{' '}
                                <strong className="font-mono-num text-slate-950">
                                  {formatIndianDate(doc.batch.depositDate)}
                                </strong>
                              </div>
                              <div className="text-[10px] font-mono-num font-semibold text-slate-800">
                                Page {page.pageNumber} of {page.totalPages}
                              </div>
                            </div>
                          </header>

                          {/* Addressed To + Credit A/c Block */}
                          <div className="grid grid-cols-12 gap-3 border border-slate-300 rounded-sm p-2.5 mb-3 bg-slate-50/60 text-[10.5px]">
                            <div className="col-span-6 space-y-0.5 border-r border-slate-300 pr-3">
                              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">
                                To, The Branch Manager
                              </div>
                              <div className="font-bold text-slate-950">
                                {doc.bankAccount.bankName} — {doc.bankAccount.branchName}
                              </div>
                              <div className="text-slate-600 leading-snug">
                                {doc.bankAccount.branchAddress}
                              </div>
                            </div>
                            <div className="col-span-6 space-y-0.5 pl-1">
                              <div className="text-[9.5px] font-semibold uppercase tracking-wider text-slate-500">
                                Please Credit Proceeds To Our Account
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-600">Account No:</span>
                                <strong className="font-mono-num text-[11.5px] text-slate-950">
                                  {doc.bankAccount.accountNumber}
                                </strong>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-600">Account Type / IFSC:</span>
                                <span className="font-mono-num font-semibold text-slate-900">
                                  {doc.bankAccount.accountType} · {doc.bankAccount.ifscCode}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span className="text-slate-600">Schedule Scope:</span>
                                <span className="font-semibold text-slate-900">
                                  {doc.clearingLabel}
                                </span>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        /* Continuation Header on Page 2+ */
                        <header className="border-b border-slate-400 pb-2 mb-2.5 flex items-center justify-between text-[10px]">
                          <div>
                            <strong className="uppercase text-slate-950">
                              {profile.companyName}
                            </strong>
                            <span className="mx-2 text-slate-400">|</span>
                            <span className="text-slate-700">{doc.title}</span>
                            <span className="mx-2 text-slate-400">|</span>
                            <span className="font-mono-num">
                              A/c: {doc.bankAccount.accountNumber}
                            </span>
                          </div>
                          <div className="text-right font-mono-num">
                            <span>Batch: {doc.batch.batchRef}</span>
                            <span className="mx-2 text-slate-400">|</span>
                            <strong className="text-slate-950">
                              Page {page.pageNumber} of {page.totalPages}
                            </strong>
                          </div>
                        </header>
                      )}

                      {/* Official Cheque Schedule Table */}
                      <table className="w-full border-collapse border border-slate-400 text-[10px]">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-400 text-slate-900 font-semibold">
                            <th className="border-r border-slate-300 py-1.5 px-1.5 text-center w-[32px]">
                              S.No
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-left w-[72px]">
                              Cheque Date
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-left w-[66px]">
                              Cheque No
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-left">
                              Drawee Bank &amp; Branch
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-left">
                              Party Name / Ref
                            </th>
                            <th className="py-1.5 px-2 text-right w-[112px]">
                              Amount (₹)
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {/* Brought Forward Row on Page 2+ */}
                          {!page.isFirstPage && (
                            <tr className="bg-slate-50 border-b border-slate-300 font-semibold text-slate-800">
                              <td
                                colSpan={5}
                                className="border-r border-slate-300 py-1 px-2 text-right italic"
                              >
                                Brought Forward (B/F) from Page {page.pageNumber - 1}:
                              </td>
                              <td className="py-1 px-2 text-right font-mono-num">
                                {formatINR(page.broughtForward, false)}
                              </td>
                            </tr>
                          )}

                          {page.rows.map(({ serialNo, cheque }) => (
                            <tr
                              key={`${doc.id}-${serialNo}`}
                              className="border-b border-slate-200 hover:bg-slate-50/40"
                            >
                              <td className="border-r border-slate-300 py-1.5 px-1.5 text-center font-mono-num text-slate-600">
                                {serialNo}
                              </td>
                              <td className="border-r border-slate-300 py-1.5 px-2 font-mono-num whitespace-nowrap">
                                {formatIndianDate(cheque.chequeDate)}
                              </td>
                              <td className="border-r border-slate-300 py-1.5 px-2 font-mono-num font-semibold text-slate-950">
                                {cheque.chequeNumber}
                              </td>
                              <td className="border-r border-slate-300 py-1.5 px-2 leading-tight">
                                <div className="font-medium text-slate-900">
                                  {cheque.draweeBank}
                                </div>
                                <div className="text-[9px] text-slate-600">
                                  {cheque.draweeBranch}
                                </div>
                              </td>
                              <td className="border-r border-slate-300 py-1.5 px-2 leading-tight">
                                <div className="font-medium text-slate-900">
                                  {cheque.partyName}
                                </div>
                                {cheque.invoiceRef && (
                                  <div className="text-[9px] font-mono-num text-slate-500">
                                    {cheque.invoiceRef}
                                  </div>
                                )}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono-num font-semibold text-slate-950 whitespace-nowrap">
                                {formatINR(cheque.amount, false)}
                              </td>
                            </tr>
                          ))}
                        </tbody>

                        <tfoot>
                          {!page.isLastPage ? (
                            <tr className="bg-slate-100 border-t border-slate-400 font-bold text-slate-950">
                              <td
                                colSpan={5}
                                className="border-r border-slate-300 py-1.5 px-2 text-right"
                              >
                                Carried Forward (C/F) to Page {page.pageNumber + 1} (Page Subtotal:{' '}
                                {formatINR(page.pageSubtotal, false)}):
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono-num">
                                {formatINR(page.carriedForward, false)}
                              </td>
                            </tr>
                          ) : (
                            <tr className="bg-slate-100 border-t-2 border-slate-900 font-bold text-slate-950 text-[11px]">
                              <td
                                colSpan={5}
                                className="border-r border-slate-300 py-2 px-2 text-right"
                              >
                                GRAND TOTAL ({doc.cheques.length} Instruments):
                              </td>
                              <td className="py-2 px-2 text-right font-mono-num whitespace-nowrap">
                                {formatINR(grandTotal, true)}
                              </td>
                            </tr>
                          )}
                        </tfoot>
                      </table>

                      {/* Total in Indian Words directly under final table */}
                      {page.isLastPage && (
                        <div className="mt-2.5 p-2 border border-slate-300 bg-slate-50 text-[10.5px]">
                          <span className="font-semibold text-slate-600">
                            Amount in Words:{' '}
                          </span>
                          <strong className="text-slate-950">
                            {numberToIndianWords(grandTotal)}
                          </strong>
                        </div>
                      )}
                    </div>

                    {/* BOTTOM CONTENT: Signatory & Teller Receipt on Final Page, or Continuation Footer */}
                    {page.isLastPage ? (
                      <footer className="space-y-3 pt-3 avoid-break">
                        {/* Perforated Bank Teller Acknowledgement Receipt */}
                        <div className="border-t-2 border-dashed border-slate-500 pt-3">
                          <div className="border border-slate-900 p-4 bg-slate-50/40">
                            <div className="flex items-center justify-between border-b border-slate-300 pb-2 mb-3">
                              <span className="text-[11.5px] font-bold uppercase tracking-wide text-slate-950">
                                Bank Acknowledgement Receipt
                              </span>
                              <span className="text-[10px] font-mono-num text-slate-600">
                                Batch: {doc.batch.batchRef} · {formatIndianDate(doc.batch.depositDate)}
                              </span>
                            </div>

                            <div className="grid grid-cols-12 gap-4 text-[11px] items-end">
                              <div className="col-span-6 space-y-1.5">
                                <div className="leading-snug">
                                  Received from <strong>{profile.companyName}</strong> for credit to{' '}
                                  <strong className="font-mono-num">
                                    {doc.bankAccount.bankName} A/c {doc.bankAccount.accountNumber}
                                  </strong>{' '}
                                  ({doc.clearingLabel}):
                                </div>
                                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 pt-0.5">
                                  <span>
                                    Total Cheques:{' '}
                                    <strong className="font-mono-num text-[12px]">
                                      {doc.cheques.length}
                                    </strong>
                                  </span>
                                  <span>
                                    Total Amount:{' '}
                                    <strong className="font-mono-num text-[12px]">
                                      {formatINR(grandTotal)}
                                    </strong>
                                  </span>
                                </div>
                                <div className="text-[9.5px] text-slate-500 italic">
                                  Subject to realization under CTS / RBI Clearing Rules.
                                </div>
                              </div>

                              <div className="col-span-6 grid grid-cols-2 gap-3 text-center text-[10px] text-slate-600">
                                <div className="border border-dashed border-slate-400 h-24 flex items-end justify-center pb-1.5 px-2">
                                  Bank Branch Stamp
                                </div>
                                <div className="border border-slate-300 h-24 flex items-end justify-center pb-1.5 px-2">
                                  Receiving Officer Sign &amp; Time
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </footer>
                    ) : (
                      <footer className="border-t border-slate-300 pt-2 flex items-center justify-between text-[9.5px] text-slate-500">
                        <span>
                          {profile.companyName} · Batch {doc.batch.batchRef}
                        </span>
                        <span>Continued on Page {page.pageNumber + 1}...</span>
                      </footer>
                    )}
                  </article>
                ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
