import React, { useMemo, useState } from 'react';
import {
  AlertOctagon,
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCheck2,
  Printer,
  UserCheck,
} from 'lucide-react';
import { BOUNCE_REASONS } from '../data/indianBanks';
import {
  BearerAuthorization,
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CorporateProfile,
} from '../types/treasury';
import {
  formatIndianDate,
  formatINR,
  numberToIndianWords,
} from '../utils/indianCurrency';
import {
  generateReturnAcknowledgementPDF,
  getCompanyMonogram,
  paginateReturnCheques,
  ReturnAckDocumentData,
} from '../utils/pdfReturnAckGenerator';

interface ReturnAckViewProps {
  profile: CorporateProfile;
  bankAccounts: CompanyBankAccount[];
  batches: ClearingBatch[];
  activeBatchId: string;
  cheques: ChequeEntry[];
  initialScope?: 'active' | 'all';
  onUpdateReturnReason: (chequeId: string, reason: string) => void;
  onLogReturnAck?: (details: {
    kind: 'PDF_DOWNLOADED' | 'PRINTED';
    chequeIds: string[];
    bankNames: string;
    batchId?: string;
    batchRef?: string;
  }) => void;
  onBackToDashboard: () => void;
}

const CUSTOM_REASON = '__CUSTOM__';

export function ReturnAckView({
  profile,
  bankAccounts,
  batches,
  activeBatchId,
  cheques,
  initialScope = 'active',
  onUpdateReturnReason,
  onLogReturnAck,
  onBackToDashboard,
}: ReturnAckViewProps) {
  const todayIso = new Date().toISOString().slice(0, 10);

  const [scopeMode, setScopeMode] = useState<'active' | 'all'>(() => {
    if (initialScope === 'all') return 'all';
    const hasInActive = cheques.some(
      (c) => c.batchId === activeBatchId && c.status === 'Returned / Bounced'
    );
    return hasInActive ? 'active' : 'all';
  });
  const [selectedBatchId, setSelectedBatchId] = useState<string>(activeBatchId);
  const [letterDate, setLetterDate] = useState<string>(todayIso);
  const [signatoryChoice, setSignatoryChoice] = useState<'sig1' | 'sig2'>('sig1');

  const [bearer, setBearer] = useState<BearerAuthorization>({
    bearerName: profile.defaultMaker.split('(')[0].trim() || '',
    bearerDesignation: 'Treasury Executive',
    idProofType: 'Employee ID / PAN',
    idProofNumber: '',
  });

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

  // Strict data filtering: include ONLY cheques marked as 'Returned / Bounced'
  const returnedCheques = useMemo(() => {
    return cheques.filter((c) => {
      if (c.status !== 'Returned / Bounced') return false;
      if (scopeMode === 'active' && selectedBatch) {
        return c.batchId === selectedBatch.id;
      }
      return true;
    });
  }, [cheques, scopeMode, selectedBatch]);

  // Group returned cheques by Deposit Bank & Branch so each letter addresses the right Branch Manager
  const ackDocuments: ReturnAckDocumentData[] = useMemo(() => {
    if (returnedCheques.length === 0) return [];
    const groups = new Map<string, ChequeEntry[]>();
    for (const chq of returnedCheques) {
      const list = groups.get(chq.companyBankAccountId) || [];
      list.push(chq);
      groups.set(chq.companyBankAccountId, list);
    }

    const docs: ReturnAckDocumentData[] = [];
    let docIdx = 1;
    groups.forEach((groupCheques, accId) => {
      const bankAccount = bankMap.get(accId) || bankAccounts[0];
      if (!bankAccount) return;
      const baseRef =
        scopeMode === 'active' && selectedBatch
          ? selectedBatch.batchRef
          : 'ALL-BATCHES';
      docs.push({
        id: `ret-ack-${accId}`,
        referenceNo: `RET-ACK/${baseRef}/${String(docIdx).padStart(2, '0')}`,
        bankAccount,
        cheques: groupCheques,
      });
      docIdx += 1;
    });

    return docs;
  }, [returnedCheques, bankMap, bankAccounts, scopeMode, selectedBatch]);

  const activeSignatoryName =
    signatoryChoice === 'sig1' ? profile.signatory1Name : profile.signatory2Name;
  const activeSignatoryDesignation =
    signatoryChoice === 'sig1'
      ? profile.signatory1Designation
      : profile.signatory2Designation;

  const handleDownloadPdf = () => {
    if (ackDocuments.length === 0) return;
    if (pdfDownloadNotice?.blobUrl) {
      URL.revokeObjectURL(pdfDownloadNotice.blobUrl);
    }
    const scopeLabel =
      scopeMode === 'active' && selectedBatch
        ? selectedBatch.batchRef
        : `${profile.pan}-ALL`;
    const result = generateReturnAcknowledgementPDF({
      profile,
      documents: ackDocuments,
      letterDate,
      bearer,
      signatoryName: activeSignatoryName,
      signatoryDesignation: activeSignatoryDesignation,
      scopeLabel,
    });
    setPdfDownloadNotice(result);
    setPrintFallbackHint(false);

    onLogReturnAck?.({
      kind: 'PDF_DOWNLOADED',
      chequeIds: returnedCheques.map((c) => c.id),
      bankNames: ackDocuments
        .map((d) => `${d.bankAccount.bankName} (${d.bankAccount.branchName})`)
        .join(', '),
      batchId: scopeMode === 'active' ? selectedBatch?.id : undefined,
      batchRef: scopeMode === 'active' ? selectedBatch?.batchRef : 'All Batches',
    });
  };

  const handleBrowserPrint = () => {
    const isInIframe = window.self !== window.top;
    window.print();
    if (isInIframe) {
      setPrintFallbackHint(true);
    }
    if (ackDocuments.length > 0) {
      onLogReturnAck?.({
        kind: 'PRINTED',
        chequeIds: returnedCheques.map((c) => c.id),
        bankNames: ackDocuments
          .map((d) => `${d.bankAccount.bankName} (${d.bankAccount.branchName})`)
          .join(', '),
        batchId: scopeMode === 'active' ? selectedBatch?.id : undefined,
        batchRef: scopeMode === 'active' ? selectedBatch?.batchRef : 'All Batches',
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Control Toolbar (Hidden on Print) */}
      <section className="no-print bg-white border border-slate-200 rounded-lg p-5 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={onBackToDashboard}
              className="mt-0.5 p-1.5 text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors"
              title="Back to Clearing Dashboard"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <FileCheck2 className="w-4 h-4 text-red-700" aria-hidden="true" />
                <span>Returned Cheque Bank Acknowledgement &amp; Authorization</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Automatically filters only Returned / Bounced cheques (excludes cleared, pending, and deposited instruments) and generates A4 bank collection letters.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={ackDocuments.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-4 h-4" aria-hidden="true" />
              <span>Download A4 PDF</span>
            </button>

            <button
              type="button"
              onClick={handleBrowserPrint}
              disabled={ackDocuments.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-4 h-4" aria-hidden="true" />
              <span>Print Letter</span>
            </button>
          </div>
        </div>

        {pdfDownloadNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                A4 Return Acknowledgement PDF generated:{' '}
                <strong className="font-mono-num">{pdfDownloadNotice.filename}</strong>
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
            Embedded preview frames may block browser print dialogs. Use{' '}
            <strong>Download A4 PDF</strong> above to save the formatted A4 letter directly.
          </div>
        )}

        {/* Filter & Letter Settings */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Returned Cheques Scope
            </label>
            <div className="flex p-0.5 bg-slate-100 border border-slate-200 rounded-md">
              <button
                type="button"
                onClick={() => setScopeMode('active')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  scopeMode === 'active'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Selected Batch
              </button>
              <button
                type="button"
                onClick={() => setScopeMode('all')}
                className={`flex-1 px-2.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                  scopeMode === 'all'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Batches
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Clearing Batch
            </label>
            <select
              disabled={scopeMode === 'all'}
              value={selectedBatch?.id || ''}
              onChange={(e) => setSelectedBatchId(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono-num font-medium border border-slate-300 rounded-md bg-white disabled:bg-slate-100 disabled:text-slate-400"
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
              Acknowledgement Letter Date
            </label>
            <input
              type="date"
              value={letterDate}
              onChange={(e) => setLetterDate(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Company Authorized Signatory
            </label>
            <select
              value={signatoryChoice}
              onChange={(e) => setSignatoryChoice(e.target.value as 'sig1' | 'sig2')}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white"
            >
              <option value="sig1">
                {profile.signatory1Name} ({profile.signatory1Designation})
              </option>
              <option value="sig2">
                {profile.signatory2Name} ({profile.signatory2Designation})
              </option>
            </select>
          </div>
        </div>

        {/* Bearer / Employee Authorization Inputs */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-md space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <UserCheck className="w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
            <span>Bearer / Employee Authorization Details (Included on Letter)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Bearer / Employee Name
              </label>
              <input
                type="text"
                value={bearer.bearerName}
                onChange={(e) => setBearer({ ...bearer, bearerName: e.target.value })}
                placeholder="e.g. Rajesh Deshmukh"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                Designation / Emp ID
              </label>
              <input
                type="text"
                value={bearer.bearerDesignation}
                onChange={(e) =>
                  setBearer({ ...bearer, bearerDesignation: e.target.value })
                }
                placeholder="e.g. Sr. Treasury Officer · EMP-208"
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                ID Proof Type
              </label>
              <select
                value={bearer.idProofType}
                onChange={(e) => setBearer({ ...bearer, idProofType: e.target.value })}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
              >
                <option value="Employee ID / PAN">Employee ID / PAN</option>
                <option value="Aadhaar Card">Aadhaar Card</option>
                <option value="PAN Card">PAN Card</option>
                <option value="Driving Licence">Driving Licence</option>
                <option value="Passport">Passport</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-600 mb-1">
                ID Proof Number
              </label>
              <input
                type="text"
                value={bearer.idProofNumber}
                onChange={(e) =>
                  setBearer({ ...bearer, idProofNumber: e.target.value.toUpperCase() })
                }
                placeholder="e.g. ABCDE1234F / EMP-208"
                className="w-full px-3 py-1.5 text-xs font-mono-num border border-slate-300 rounded-md bg-white"
              />
            </div>
          </div>
        </div>

        {/* Inline Returned Cheques & Reason of Return Editor */}
        {returnedCheques.length > 0 && (
          <div className="border border-slate-200 rounded-md overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-900">
                Returned Cheques Included ({returnedCheques.length}) — Verify or Customize Reason of Return
              </span>
              <span className="text-slate-500">
                Generating {ackDocuments.length} Bank Branch Letter{ackDocuments.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="divide-y divide-slate-200">
              {returnedCheques.map((chq) => {
                const currentReason = chq.bounceReason || '';
                const isPreset = BOUNCE_REASONS.includes(currentReason);
                return (
                  <div
                    key={chq.id}
                    className="px-4 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs bg-white"
                  >
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="font-mono-num font-bold text-slate-900">
                        #{chq.chequeNumber}
                      </span>
                      <span className="font-mono-num text-slate-500">
                        {formatIndianDate(chq.chequeDate)}
                      </span>
                      <span className="font-medium text-slate-800">
                        {chq.draweeBank} ({chq.draweeBranch})
                      </span>
                      <span className="font-mono-num font-semibold text-slate-900">
                        {formatINR(chq.amount)}
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 lg:w-[440px] shrink-0">
                      <select
                        aria-label={`Reason of return preset for cheque ${chq.chequeNumber}`}
                        value={isPreset ? currentReason : CUSTOM_REASON}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === CUSTOM_REASON) {
                            if (isPreset || !currentReason) {
                              onUpdateReturnReason(chq.id, 'Insufficient Funds');
                            }
                          } else {
                            onUpdateReturnReason(chq.id, val);
                          }
                        }}
                        className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      >
                        {BOUNCE_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                        <option value={CUSTOM_REASON}>Custom Reason (Text input)</option>
                      </select>

                      <input
                        type="text"
                        aria-label={`Custom reason of return for cheque ${chq.chequeNumber}`}
                        value={currentReason}
                        onChange={(e) => onUpdateReturnReason(chq.id, e.target.value)}
                        placeholder="Enter reason of return..."
                        className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 rounded bg-white"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* A4 Print & Preview Sheets */}
      <div className="print-only-root">
        {ackDocuments.length === 0 ? (
          <div className="no-print bg-white border border-slate-200 rounded-lg p-12 text-center space-y-2">
            <AlertOctagon className="w-8 h-8 text-slate-400 mx-auto" />
            <p className="text-sm font-medium text-slate-900">
              No Returned / Bounced cheques found in the selected scope
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Cleared, pending, and deposited cheques are excluded automatically. Mark at least one instrument as Returned / Bounced in the Dashboard or switch scope to All Batches.
            </p>
          </div>
        ) : (
          ackDocuments.map((docItem) => {
            const pages = paginateReturnCheques(docItem.cheques);
            const grandTotal = docItem.cheques.reduce((s, c) => s + c.amount, 0);

            return (
              <div key={docItem.id}>
                {pages.map((page) => (
                  <article
                    key={`${docItem.id}-p${page.pageNumber}`}
                    className="a4-sheet text-slate-900"
                  >
                    <div>
                      {page.isFirstPage ? (
                        <>
                          {/* Official Company Letterhead with Logo */}
                          <header className="border-b-2 border-slate-900 pb-3 mb-4 flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 max-w-[68%]">
                              {profile.logoDataUrl ? (
                                <img
                                  src={profile.logoDataUrl}
                                  alt={`${profile.companyName} logo`}
                                  className="w-12 h-12 object-contain border border-slate-200 rounded-sm bg-white p-0.5 shrink-0"
                                />
                              ) : (
                                <div className="w-12 h-12 bg-[#0B192C] text-white flex items-center justify-center font-display font-bold text-base tracking-tight shrink-0">
                                  {getCompanyMonogram(profile.companyName)}
                                </div>
                              )}
                              <div className="space-y-0.5">
                                <h1 className="text-[14.5px] font-bold tracking-tight text-slate-950 uppercase leading-tight">
                                  {profile.companyName}
                                </h1>
                                <p className="text-[9.5px] leading-snug text-slate-700">
                                  {profile.registeredAddress}
                                </p>
                                <p className="text-[9.5px] text-slate-600">
                                  {profile.contactPhone && <span>Tel: {profile.contactPhone}</span>}
                                  {profile.contactPhone && profile.treasuryEmail && (
                                    <span> &nbsp;|&nbsp; </span>
                                  )}
                                  {profile.treasuryEmail && (
                                    <span>Email: {profile.treasuryEmail}</span>
                                  )}
                                </p>
                                <p className="text-[9px] text-slate-600 font-mono-num">
                                  PAN: {profile.pan} &nbsp;|&nbsp; GSTIN: {profile.gstin}
                                  {profile.cin ? ` | CIN: ${profile.cin}` : ''}
                                </p>
                              </div>
                            </div>

                            <div className="text-right space-y-1 shrink-0">
                              <div className="text-[10px] font-bold tracking-wide text-slate-950 border border-slate-900 px-2 py-0.5 inline-block">
                                RETURN CHEQUE ACKNOWLEDGEMENT
                              </div>
                              <div className="text-[10px] text-slate-700 pt-0.5">
                                Date:{' '}
                                <strong className="font-mono-num text-slate-950">
                                  {formatIndianDate(letterDate)}
                                </strong>
                              </div>
                              <div className="text-[10px] text-slate-700">
                                Ref:{' '}
                                <strong className="font-mono-num text-slate-950">
                                  {docItem.referenceNo}
                                </strong>
                              </div>
                              <div className="text-[9.5px] font-mono-num font-semibold text-slate-700">
                                Page {page.pageNumber} of {page.totalPages}
                              </div>
                            </div>
                          </header>

                          {/* Addressed To: The Branch Manager */}
                          <div className="flex items-start justify-between gap-6 mb-3 text-[10.5px]">
                            <div className="space-y-0.5 max-w-[60%]">
                              <div className="font-bold text-slate-950">To,</div>
                              <div className="font-bold text-slate-950">
                                The Branch Manager,
                              </div>
                              <div className="font-bold text-slate-950">
                                {docItem.bankAccount.bankName} — {docItem.bankAccount.branchName}
                              </div>
                              <div className="text-slate-600 leading-snug">
                                {docItem.bankAccount.branchAddress}
                              </div>
                            </div>

                            <div className="text-right text-[10px] text-slate-700 space-y-0.5 shrink-0">
                              <div>
                                Account No:{' '}
                                <strong className="font-mono-num text-slate-950">
                                  {docItem.bankAccount.accountNumber}
                                </strong>
                              </div>
                              <div>
                                A/c Type &amp; IFSC:{' '}
                                <strong className="font-mono-num text-slate-950">
                                  {docItem.bankAccount.accountType} · {docItem.bankAccount.ifscCode}
                                </strong>
                              </div>
                            </div>
                          </div>

                          {/* Clear Subject Line */}
                          <div className="bg-slate-100 border border-slate-300 px-3 py-2 mb-3 text-[11px] font-bold text-slate-950">
                            Subject: Acknowledgement &amp; Authorization for Collection of Returned Cheque(s)
                          </div>

                          {/* Formal Letter Intro */}
                          <p className="text-[10.5px] leading-relaxed text-slate-800 mb-3">
                            Dear Sir/Madam, We hereby authorize our representative named below to collect the original dishonoured / returned cheque(s) along with the respective Bank Return Memo(s) pertaining to our {docItem.bankAccount.accountType} (<span className="font-mono-num font-semibold">{docItem.bankAccount.accountNumber}</span>) as detailed below:
                          </p>
                        </>
                      ) : (
                        <header className="border-b border-slate-400 pb-2 mb-3 flex items-center justify-between text-[10px]">
                          <div>
                            <strong className="uppercase text-slate-950">
                              {profile.companyName}
                            </strong>
                            <span className="mx-2 text-slate-400">|</span>
                            <span>Return Cheque Acknowledgement</span>
                          </div>
                          <div className="font-mono-num">
                            <span>{docItem.referenceNo}</span>
                            <span className="mx-2 text-slate-400">|</span>
                            <strong>
                              Page {page.pageNumber} of {page.totalPages}
                            </strong>
                          </div>
                        </header>
                      )}

                      {/* Required 6-Column Returned Cheques Summary Table */}
                      <table className="w-full border-collapse border border-slate-400 text-[10px]">
                        <thead>
                          <tr className="bg-slate-100 border-b border-slate-400 text-slate-900 font-semibold">
                            <th className="border-r border-slate-300 py-1.5 px-1.5 text-center w-[34px]">
                              S.No
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-left w-[78px]">
                              Cheque Number
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-left w-[74px]">
                              Cheque Date
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-left">
                              Customer Name
                            </th>
                            <th className="border-r border-slate-300 py-1.5 px-2 text-right w-[106px]">
                              Amount (₹)
                            </th>
                            <th className="py-1.5 px-2 text-left w-[158px]">
                              Reason of Return
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {page.rows.map(({ serialNo, cheque }) => (
                            <tr
                              key={`${docItem.id}-${serialNo}`}
                              className="border-b border-slate-200"
                            >
                              <td className="border-r border-slate-300 py-1.5 px-1.5 text-center font-mono-num text-slate-600">
                                {serialNo}
                              </td>
                              <td className="border-r border-slate-300 py-1.5 px-2 font-mono-num font-bold text-slate-950">
                                {cheque.chequeNumber}
                              </td>
                              <td className="border-r border-slate-300 py-1.5 px-2 font-mono-num whitespace-nowrap">
                                {formatIndianDate(cheque.chequeDate)}
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
                              <td className="border-r border-slate-300 py-1.5 px-2 text-right font-mono-num font-semibold text-slate-950 whitespace-nowrap">
                                {formatINR(cheque.amount, false)}
                              </td>
                              <td className="py-1.5 px-2 font-medium text-red-800 leading-tight">
                                {cheque.bounceReason || 'Reason Not Specified'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        {page.isLastPage && (
                          <tfoot>
                            <tr className="bg-slate-100 border-t-2 border-slate-900 font-bold text-slate-950 text-[10.5px]">
                              <td
                                colSpan={4}
                                className="border-r border-slate-300 py-2 px-2 text-right"
                              >
                                TOTAL RETURNED CHEQUES ({docItem.cheques.length}):
                              </td>
                              <td className="border-r border-slate-300 py-2 px-2 text-right font-mono-num whitespace-nowrap">
                                {formatINR(grandTotal, true)}
                              </td>
                              <td className="py-2 px-2 text-[9.5px] font-normal text-slate-600">
                                Collect with Return Memo(s)
                              </td>
                            </tr>
                          </tfoot>
                        )}
                      </table>

                      {page.isLastPage && (
                        <>
                          <div className="mt-2.5 p-2 border border-slate-300 bg-slate-50 text-[10px]">
                            <span className="font-semibold text-slate-600">
                              Total Return Value in Words:{' '}
                            </span>
                            <strong className="text-slate-950">
                              {numberToIndianWords(grandTotal)}
                            </strong>
                          </div>
                          <p className="mt-3 text-[10px] text-slate-700 leading-relaxed">
                            Kindly hand over the above original returned cheque(s) and Bank Return Memo(s) to our authorized bearer against verification of ID proof.
                          </p>
                        </>
                      )}
                    </div>

                    {/* BOTTOM: Bank Counter Acknowledgement */}
                    {page.isLastPage ? (
                      <footer className="space-y-3 pt-4 avoid-break">
                        {/* Perforated Bank Counter Acknowledgement */}
                        <div className="border-t border-dashed border-slate-400 pt-2.5 text-[9.5px] text-slate-600 space-y-2">
                          <div className="font-bold uppercase tracking-wide text-slate-700">
                            Bank Counter Acknowledgement (For Bank / Bearer Use)
                          </div>
                          <div>
                            Received {docItem.cheques.length} original returned cheque(s) &amp; Bank Return Memo(s) in good order.
                          </div>
                          <div className="flex items-center justify-between pt-3">
                            <span>
                              Bearer Signature &amp; Date: ___________________________
                            </span>
                            <span>
                              Bank Officer Sign &amp; Stamp: ___________________________
                            </span>
                          </div>
                        </div>
                      </footer>
                    ) : (
                      <footer className="border-t border-slate-300 pt-2 flex items-center justify-between text-[9.5px] text-slate-500">
                        <span>
                          {profile.companyName} · {docItem.referenceNo}
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
