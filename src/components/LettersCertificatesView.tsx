import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileBadge2,
  Landmark,
  Printer,
  RotateCcw,
  ScrollText,
} from 'lucide-react';
import {
  ChequeEntry,
  CompanyBankAccount,
  CorporateProfile,
  CustomerProfile,
} from '../types/treasury';
import {
  formatIndianDate,
  formatINR,
  numberToIndianWords,
} from '../utils/indianCurrency';
import {
  generateDdCancellationPdf,
  generateNocLetterPdf,
} from '../utils/pdfLettersGenerator';
import { getCompanyMonogram } from '../utils/pdfReturnAckGenerator';

type LetterTab = 'noc' | 'dd-cancellation';

export interface LetterAuditPayload {
  letterType: 'NOC' | 'DD_CANCELLATION';
  actionMode: 'PRINTED' | 'PDF_DOWNLOADED';
  refNo: string;
  subjectPartyOrBank: string;
  amount: number;
  instrumentOrAccountRef?: string;
}

interface LettersCertificatesViewProps {
  profile: CorporateProfile;
  bankAccounts: CompanyBankAccount[];
  customers?: CustomerProfile[];
  cheques: ChequeEntry[];
  onLogLetterGenerated?: (payload: LetterAuditPayload) => void;
}

const DD_CANCELLATION_PRESETS = [
  'DD not utilized / Purpose cancelled',
  'Purpose cancelled',
  'Not utilized',
  'Technical error',
  'Expired',
];

const PAYMENT_MODE_OPTIONS = [
  'NEFT / RTGS Transfer',
  'Cheque Clearing',
  'IMPS / UPI',
  'Cash Receipt',
  'Full & Final Settlement',
];

function getIndianFinancialYearLabel(dateStr: string): string {
  const dt = new Date(`${dateStr}T00:00:00`);
  const year = Number.isNaN(dt.getTime()) ? new Date().getFullYear() : dt.getFullYear();
  const monthIdx = Number.isNaN(dt.getTime()) ? new Date().getMonth() : dt.getMonth();
  const fyStart = monthIdx >= 3 ? year : year - 1;
  const fyEndShort = String((fyStart + 1) % 100).padStart(2, '0');
  return `${fyStart}-${fyEndShort}`;
}

export function LettersCertificatesView({
  profile,
  bankAccounts,
  customers = [],
  cheques,
  onLogLetterGenerated,
}: LettersCertificatesViewProps) {
  const todayIso = new Date().toISOString().slice(0, 10);
  const fyLabel = getIndianFinancialYearLabel(todayIso);
  const defaultBank =
    bankAccounts.find((b) => b.isDefault) || bankAccounts[0] || null;

  const [activeTab, setActiveTab] = useState<LetterTab>('noc');
  const [pdfNotice, setPdfNotice] = useState<{
    filename: string;
    blobUrl: string;
  } | null>(null);
  const [printFallbackHint, setPrintFallbackHint] = useState(false);

  // Quick-select party directory built from CustomerProfiles + distinct Cheque party names
  const partyDirectory = useMemo(() => {
    const map = new Map<
      string,
      { name: string; address: string; code: string }
    >();
    for (const cust of customers) {
      const cleanName = cust.partyName.trim();
      if (!cleanName) continue;
      map.set(cleanName.toLowerCase(), {
        name: cleanName,
        address: cust.address || '',
        code: cust.customerCode || '',
      });
    }
    for (const chq of cheques) {
      const cleanName = chq.partyName.trim();
      if (!cleanName) continue;
      const key = cleanName.toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          name: cleanName,
          address: '',
          code: chq.customerCode || '',
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [customers, cheques]);

  // Tab 1: NOC Letter State
  const [nocDate, setNocDate] = useState(todayIso);
  const [nocRefNo, setNocRefNo] = useState(`NOC/${fyLabel}/001`);
  const [nocSelectedPartyKey, setNocSelectedPartyKey] = useState('');
  const [nocCustomerName, setNocCustomerName] = useState('');
  const [nocCustomerAddress, setNocCustomerAddress] = useState('');
  const [nocLoanAccountNo, setNocLoanAccountNo] = useState('');
  const [nocLoanAmountInput, setNocLoanAmountInput] = useState('500000');
  const [nocRepaymentDate, setNocRepaymentDate] = useState(todayIso);
  const [nocPaymentMode, setNocPaymentMode] = useState('NEFT / RTGS Transfer');
  const [nocPaymentRef, setNocPaymentRef] = useState('');
  const [nocSignatoryChoice, setNocSignatoryChoice] = useState<'sig1' | 'sig2' | 'custom'>('sig1');
  const [nocSignatoryName, setNocSignatoryName] = useState(
    profile.signatory1Name || profile.defaultChecker || ''
  );
  const [nocSignatoryDesignation, setNocSignatoryDesignation] = useState(
    profile.signatory1Designation || 'Authorized Signatory'
  );

  // Tab 2: DD Cancellation State
  const [ddLetterDate, setDdLetterDate] = useState(todayIso);
  const [ddRefNo, setDdRefNo] = useState(`DDC/${fyLabel}/001`);
  const [ddSelectedBankId, setDdSelectedBankId] = useState<string>(
    defaultBank?.id || 'CUSTOM'
  );
  const [ddBankName, setDdBankName] = useState(defaultBank?.bankName || '');
  const [ddBranchName, setDdBranchName] = useState(
    defaultBank?.branchName || ''
  );
  const [ddBranchAddress, setDdBranchAddress] = useState(
    defaultBank?.branchAddress || ''
  );
  const [ddAccountNumber, setDdAccountNumber] = useState(
    defaultBank?.accountNumber || ''
  );
  const [ddNumber, setDdNumber] = useState('');
  const [ddDate, setDdDate] = useState(todayIso);
  const [ddAmountInput, setDdAmountInput] = useState('125000');
  const [ddPayeeName, setDdPayeeName] = useState('');
  const [ddReasonPreset, setDdReasonPreset] = useState(
    DD_CANCELLATION_PRESETS[0]
  );
  const [ddReasonText, setDdReasonText] = useState(DD_CANCELLATION_PRESETS[0]);
  const [ddSignatoryChoice, setDdSignatoryChoice] = useState<'sig1' | 'sig2' | 'custom'>('sig1');
  const [ddSignatoryName, setDdSignatoryName] = useState(
    profile.signatory1Name || profile.defaultChecker || ''
  );
  const [ddSignatoryDesignation, setDdSignatoryDesignation] = useState(
    profile.signatory1Designation || 'Authorized Signatory'
  );

  const nocAmountNum = useMemo(() => {
    const cleaned = Number(String(nocLoanAmountInput).replace(/,/g, ''));
    return Number.isFinite(cleaned) && cleaned >= 0 ? cleaned : 0;
  }, [nocLoanAmountInput]);

  const ddAmountNum = useMemo(() => {
    const cleaned = Number(String(ddAmountInput).replace(/,/g, ''));
    return Number.isFinite(cleaned) && cleaned >= 0 ? cleaned : 0;
  }, [ddAmountInput]);

  const combinedNocPaymentMode = useMemo(() => {
    const mode = nocPaymentMode.trim();
    const ref = nocPaymentRef.trim();
    if (mode && ref) return `${mode} (Ref: ${ref})`;
    return mode || ref || 'Bank Transfer / Cheque';
  }, [nocPaymentMode, nocPaymentRef]);

  const handleSelectNocParty = (selectedKey: string) => {
    setNocSelectedPartyKey(selectedKey);
    if (!selectedKey) return;
    const match = partyDirectory.find(
      (p) => p.name.toLowerCase() === selectedKey
    );
    if (match) {
      setNocCustomerName(match.name);
      if (match.address) setNocCustomerAddress(match.address);
      if (match.code && !nocLoanAccountNo.trim()) {
        setNocLoanAccountNo(match.code);
      }
    }
  };

  const handleSelectDdBank = (bankId: string) => {
    setDdSelectedBankId(bankId);
    if (bankId === 'CUSTOM') return;
    const found = bankAccounts.find((b) => b.id === bankId);
    if (found) {
      setDdBankName(found.bankName);
      setDdBranchName(found.branchName);
      setDdBranchAddress(found.branchAddress || '');
      setDdAccountNumber(found.accountNumber);
    }
  };

  const handleSignatoryPresetChange = (
    target: 'noc' | 'dd',
    choice: 'sig1' | 'sig2' | 'custom'
  ) => {
    const name =
      choice === 'sig1'
        ? profile.signatory1Name
        : choice === 'sig2'
        ? profile.signatory2Name
        : target === 'noc'
        ? nocSignatoryName
        : ddSignatoryName;
    const designation =
      choice === 'sig1'
        ? profile.signatory1Designation
        : choice === 'sig2'
        ? profile.signatory2Designation
        : target === 'noc'
        ? nocSignatoryDesignation
        : ddSignatoryDesignation;

    if (target === 'noc') {
      setNocSignatoryChoice(choice);
      if (choice !== 'custom') {
        setNocSignatoryName(name);
        setNocSignatoryDesignation(designation);
      }
    } else {
      setDdSignatoryChoice(choice);
      if (choice !== 'custom') {
        setDdSignatoryName(name);
        setDdSignatoryDesignation(designation);
      }
    }
  };

  const handleResetActiveForm = () => {
    setPdfNotice(null);
    setPrintFallbackHint(false);
    if (activeTab === 'noc') {
      setNocDate(todayIso);
      setNocRefNo(`NOC/${fyLabel}/001`);
      setNocSelectedPartyKey('');
      setNocCustomerName('');
      setNocCustomerAddress('');
      setNocLoanAccountNo('');
      setNocLoanAmountInput('500000');
      setNocRepaymentDate(todayIso);
      setNocPaymentMode('NEFT / RTGS Transfer');
      setNocPaymentRef('');
      setNocSignatoryChoice('sig1');
      setNocSignatoryName(profile.signatory1Name || profile.defaultChecker || '');
      setNocSignatoryDesignation(
        profile.signatory1Designation || 'Authorized Signatory'
      );
    } else {
      setDdLetterDate(todayIso);
      setDdRefNo(`DDC/${fyLabel}/001`);
      setDdSelectedBankId(defaultBank?.id || 'CUSTOM');
      setDdBankName(defaultBank?.bankName || '');
      setDdBranchName(defaultBank?.branchName || '');
      setDdBranchAddress(defaultBank?.branchAddress || '');
      setDdAccountNumber(defaultBank?.accountNumber || '');
      setDdNumber('');
      setDdDate(todayIso);
      setDdAmountInput('125000');
      setDdPayeeName('');
      setDdReasonPreset(DD_CANCELLATION_PRESETS[0]);
      setDdReasonText(DD_CANCELLATION_PRESETS[0]);
      setDdSignatoryChoice('sig1');
      setDdSignatoryName(profile.signatory1Name || profile.defaultChecker || '');
      setDdSignatoryDesignation(
        profile.signatory1Designation || 'Authorized Signatory'
      );
    }
  };

  const handleBrowserPrint = () => {
    const isInIframe = window.self !== window.top;
    window.print();
    if (isInIframe) {
      setPrintFallbackHint(true);
    }

    if (activeTab === 'noc') {
      onLogLetterGenerated?.({
        letterType: 'NOC',
        actionMode: 'PRINTED',
        refNo: nocRefNo.trim() || `NOC/${fyLabel}`,
        subjectPartyOrBank: nocCustomerName.trim() || 'Customer NOC',
        amount: nocAmountNum,
        instrumentOrAccountRef: nocLoanAccountNo.trim() || undefined,
      });
    } else {
      onLogLetterGenerated?.({
        letterType: 'DD_CANCELLATION',
        actionMode: 'PRINTED',
        refNo: ddRefNo.trim() || `DDC/${fyLabel}`,
        subjectPartyOrBank: `${ddBankName || 'Bank'} (${ddBranchName || 'Branch'})`,
        amount: ddAmountNum,
        instrumentOrAccountRef: ddNumber.trim() || undefined,
      });
    }
  };

  const handleDownloadPdf = () => {
    if (pdfNotice?.blobUrl) {
      URL.revokeObjectURL(pdfNotice.blobUrl);
    }
    setPrintFallbackHint(false);

    if (activeTab === 'noc') {
      const result = generateNocLetterPdf(profile, {
        letterDate: nocDate,
        refNo: nocRefNo,
        customerName: nocCustomerName,
        customerAddress: nocCustomerAddress,
        loanAccountNo: nocLoanAccountNo,
        loanAmount: nocAmountNum,
        repaymentDate: nocRepaymentDate,
        paymentMode: combinedNocPaymentMode,
        signatoryName: nocSignatoryName,
        signatoryDesignation: nocSignatoryDesignation,
      });
      setPdfNotice(result);
      onLogLetterGenerated?.({
        letterType: 'NOC',
        actionMode: 'PDF_DOWNLOADED',
        refNo: nocRefNo.trim() || `NOC/${fyLabel}`,
        subjectPartyOrBank: nocCustomerName.trim() || 'Customer NOC',
        amount: nocAmountNum,
        instrumentOrAccountRef: nocLoanAccountNo.trim() || undefined,
      });
    } else {
      const result = generateDdCancellationPdf(profile, {
        letterDate: ddLetterDate,
        refNo: ddRefNo,
        bankName: ddBankName,
        branchName: ddBranchName,
        branchAddress: ddBranchAddress,
        accountNumber: ddAccountNumber,
        ddNumber,
        ddDate,
        ddAmount: ddAmountNum,
        payeeName: ddPayeeName,
        cancellationReason: ddReasonText,
        signatoryName: ddSignatoryName,
        signatoryDesignation: ddSignatoryDesignation,
      });
      setPdfNotice(result);
      onLogLetterGenerated?.({
        letterType: 'DD_CANCELLATION',
        actionMode: 'PDF_DOWNLOADED',
        refNo: ddRefNo.trim() || `DDC/${fyLabel}`,
        subjectPartyOrBank: `${ddBankName || 'Bank'} (${ddBranchName || 'Branch'})`,
        amount: ddAmountNum,
        instrumentOrAccountRef: ddNumber.trim() || undefined,
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Module Bar & Selector (Hidden on Print) */}
      <section className="no-print bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-md bg-[#0B192C] text-white flex items-center justify-center shrink-0">
              <ScrollText className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Letters &amp; Certificates (NOC &amp; DD Cancellation)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Draft official No Objection Certificates and Bank Demand Draft Cancellation letters on{' '}
                <strong className="text-slate-700">{profile.companyName}</strong> letterhead with live A4 preview.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleResetActiveForm}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset Fields</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadPdf}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Download A4 PDF</span>
            </button>

            <button
              type="button"
              onClick={handleBrowserPrint}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Print / Save as PDF</span>
            </button>
          </div>
        </div>

        {/* Two-Tab Selector */}
        <div
          className="inline-flex p-0.5 bg-slate-100 border border-slate-200 rounded-md"
          role="tablist"
          aria-label="Letter Template Selector"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'noc'}
            onClick={() => {
              setActiveTab('noc');
              setPdfNotice(null);
              setPrintFallbackHint(false);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'noc'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <FileBadge2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>NOC Letter (No Objection Certificate)</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'dd-cancellation'}
            onClick={() => {
              setActiveTab('dd-cancellation');
              setPdfNotice(null);
              setPrintFallbackHint(false);
            }}
            className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'dd-cancellation'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Landmark className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Bank DD Cancellation Letter</span>
          </button>
        </div>

        {pdfNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-md text-xs text-emerald-950 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              <span>
                A4 PDF generated:{' '}
                <strong className="font-mono-num">{pdfNotice.filename}</strong>
              </span>
            </div>
            <a
              href={pdfNotice.blobUrl}
              download={pdfNotice.filename}
              className="font-semibold text-emerald-800 underline hover:text-emerald-950"
            >
              Click here if download didn&apos;t start
            </a>
          </div>
        )}

        {printFallbackHint && (
          <div className="p-3 bg-slate-100 border border-slate-300 rounded-md text-xs text-slate-800">
            Embedded preview frames may block the browser print dialog. Use{' '}
            <strong>Download A4 PDF</strong> above to save the formatted A4 letter directly.
          </div>
        )}
      </section>

      {/* Split-Screen Workspace: Form (Left) + Live A4 Preview (Right) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start print:block">
        {/* Left Input Form (Hidden on Print) */}
        <section className="no-print xl:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-5">
          {activeTab === 'noc' ? (
            <>
              <div className="pb-3 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  NOC Certificate Details
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  All changes reflect immediately in the official A4 letter preview.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Letter Date
                  </label>
                  <input
                    type="date"
                    value={nocDate}
                    onChange={(e) => setNocDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Reference No.
                  </label>
                  <input
                    type="text"
                    value={nocRefNo}
                    onChange={(e) => setNocRefNo(e.target.value)}
                    placeholder={`NOC/${fyLabel}/001`}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>
              </div>

              {partyDirectory.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Quick-Select Existing Party / Customer
                  </label>
                  <select
                    value={nocSelectedPartyKey}
                    onChange={(e) => handleSelectNocParty(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  >
                    <option value="">
                      -- Select from {partyDirectory.length} company parties or type below --
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

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Customer / Party Name
                </label>
                <input
                  type="text"
                  value={nocCustomerName}
                  onChange={(e) => {
                    setNocCustomerName(e.target.value);
                    setNocSelectedPartyKey('');
                  }}
                  placeholder="e.g., M/s. Sri Venkateswara Enterprises"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Ref / Loan Account No. (Optional)
                  </label>
                  <input
                    type="text"
                    value={nocLoanAccountNo}
                    onChange={(e) => setNocLoanAccountNo(e.target.value)}
                    placeholder="e.g., LN-2025-8842"
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Repayment / Closure Date
                  </label>
                  <input
                    type="date"
                    value={nocRepaymentDate}
                    onChange={(e) => setNocRepaymentDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Customer Address / ID (Optional)
                </label>
                <textarea
                  rows={2}
                  value={nocCustomerAddress}
                  onChange={(e) => setNocCustomerAddress(e.target.value)}
                  placeholder="Registered office or borrower address..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15 resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Loan / Facility Amount (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={nocLoanAmountInput}
                  onChange={(e) => setNocLoanAmountInput(e.target.value)}
                  placeholder="500000"
                  className="w-full px-3 py-2 text-xs font-mono-num font-semibold border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
                <div className="mt-1.5 text-[11px] text-slate-600 space-y-0.5">
                  <div>
                    Formatted:{' '}
                    <strong className="font-mono-num text-slate-900">
                      {formatINR(nocAmountNum)}
                    </strong>
                  </div>
                  <div className="text-slate-500">
                    {numberToIndianWords(nocAmountNum)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Payment Mode
                  </label>
                  <select
                    value={nocPaymentMode}
                    onChange={(e) => setNocPaymentMode(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  >
                    {PAYMENT_MODE_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    UTR / Cheque / Receipt Ref (Optional)
                  </label>
                  <input
                    type="text"
                    value={nocPaymentRef}
                    onChange={(e) => setNocPaymentRef(e.target.value)}
                    placeholder="e.g., UTR99281726 or Chq #004512"
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-800">
                    Authorized Signatory
                  </label>
                  <div className="inline-flex p-0.5 bg-slate-100 border border-slate-200 rounded text-[11px]">
                    <button
                      type="button"
                      onClick={() => handleSignatoryPresetChange('noc', 'sig1')}
                      className={`px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                        nocSignatoryChoice === 'sig1'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Signatory 1
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSignatoryPresetChange('noc', 'sig2')}
                      className={`px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                        nocSignatoryChoice === 'sig2'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Signatory 2
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Signatory Name
                    </label>
                    <input
                      type="text"
                      value={nocSignatoryName}
                      onChange={(e) => {
                        setNocSignatoryName(e.target.value);
                        setNocSignatoryChoice('custom');
                      }}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Designation
                    </label>
                    <input
                      type="text"
                      value={nocSignatoryDesignation}
                      onChange={(e) => {
                        setNocSignatoryDesignation(e.target.value);
                        setNocSignatoryChoice('custom');
                      }}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                    />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="pb-3 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">
                  Bank Demand Draft Cancellation Details
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Select a company bank account or enter custom branch details to address the Branch Manager.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Letter Date
                  </label>
                  <input
                    type="date"
                    value={ddLetterDate}
                    onChange={(e) => setDdLetterDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Reference No.
                  </label>
                  <input
                    type="text"
                    value={ddRefNo}
                    onChange={(e) => setDdRefNo(e.target.value)}
                    placeholder={`DDC/${fyLabel}/001`}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>
              </div>

              {bankAccounts.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Quick-Select Company Bank Account
                  </label>
                  <select
                    value={ddSelectedBankId}
                    onChange={(e) => handleSelectDdBank(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  >
                    {bankAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.bankName} — {acc.branchName} (A/c {acc.accountNumber})
                      </option>
                    ))}
                    <option value="CUSTOM">Custom Bank / Branch Entry</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Bank Name
                  </label>
                  <input
                    type="text"
                    value={ddBankName}
                    onChange={(e) => {
                      setDdBankName(e.target.value);
                      setDdSelectedBankId('CUSTOM');
                    }}
                    placeholder="e.g., State Bank of India"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Branch Name
                  </label>
                  <input
                    type="text"
                    value={ddBranchName}
                    onChange={(e) => {
                      setDdBranchName(e.target.value);
                      setDdSelectedBankId('CUSTOM');
                    }}
                    placeholder="e.g., Ashok Nagar Branch, Chennai"
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Company Current / OD Account Number
                </label>
                <input
                  type="text"
                  value={ddAccountNumber}
                  onChange={(e) => setDdAccountNumber(e.target.value)}
                  placeholder="e.g., 309281726354"
                  className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Demand Draft (DD) Number
                  </label>
                  <input
                    type="text"
                    value={ddNumber}
                    onChange={(e) => setDdNumber(e.target.value)}
                    placeholder="e.g., 458921"
                    className="w-full px-3 py-2 text-xs font-mono-num font-semibold border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    DD Issue Date
                  </label>
                  <input
                    type="date"
                    value={ddDate}
                    onChange={(e) => setDdDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono-num border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  DD Amount (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={ddAmountInput}
                  onChange={(e) => setDdAmountInput(e.target.value)}
                  placeholder="125000"
                  className="w-full px-3 py-2 text-xs font-mono-num font-semibold border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
                <div className="mt-1.5 text-[11px] text-slate-600 space-y-0.5">
                  <div>
                    Formatted:{' '}
                    <strong className="font-mono-num text-slate-900">
                      {formatINR(ddAmountNum)}
                    </strong>
                  </div>
                  <div className="text-slate-500">
                    {numberToIndianWords(ddAmountNum)}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  DD Favouring / Payee Name
                </label>
                <input
                  type="text"
                  value={ddPayeeName}
                  onChange={(e) => setDdPayeeName(e.target.value)}
                  placeholder="e.g., Tamil Nadu Electricity Board / Vendor Name"
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  Reason for Cancellation
                </label>
                <select
                  value={ddReasonPreset}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDdReasonPreset(val);
                    if (val !== '__CUSTOM__') {
                      setDdReasonText(val);
                    }
                  }}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                >
                  {DD_CANCELLATION_PRESETS.map((preset) => (
                    <option key={preset} value={preset}>
                      {preset}
                    </option>
                  ))}
                  <option value="__CUSTOM__">Custom Reason</option>
                </select>
                <input
                  type="text"
                  value={ddReasonText}
                  onChange={(e) => {
                    setDdReasonText(e.target.value);
                    setDdReasonPreset('__CUSTOM__');
                  }}
                  placeholder="Enter reason for cancellation..."
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                />
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-slate-800">
                    Authorized Signatory
                  </label>
                  <div className="inline-flex p-0.5 bg-slate-100 border border-slate-200 rounded text-[11px]">
                    <button
                      type="button"
                      onClick={() => handleSignatoryPresetChange('dd', 'sig1')}
                      className={`px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                        ddSignatoryChoice === 'sig1'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Signatory 1
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSignatoryPresetChange('dd', 'sig2')}
                      className={`px-2 py-0.5 rounded font-medium whitespace-nowrap ${
                        ddSignatoryChoice === 'sig2'
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600'
                      }`}
                    >
                      Signatory 2
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Signatory Name
                    </label>
                    <input
                      type="text"
                      value={ddSignatoryName}
                      onChange={(e) => {
                        setDdSignatoryName(e.target.value);
                        setDdSignatoryChoice('custom');
                      }}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-600 mb-1">
                      Designation
                    </label>
                    <input
                      type="text"
                      value={ddSignatoryDesignation}
                      onChange={(e) => {
                        setDdSignatoryDesignation(e.target.value);
                        setDdSignatoryChoice('custom');
                      }}
                      className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md bg-white"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* Right Live A4 Preview & Print Root */}
        <div className="xl:col-span-7 overflow-x-auto pb-2 print:overflow-visible print:pb-0 print:w-full">
          <div className="print-only-root">
            {activeTab === 'noc' ? (
              <article className="a4-sheet text-slate-900">
                <div>
                  {/* Company Letterhead Header */}
                  <header className="border-b-2 border-slate-900 pb-4 mb-6 flex items-start justify-between gap-4">
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
                        <h1 className="text-[15px] font-bold tracking-tight text-slate-950 uppercase leading-tight">
                          {profile.companyName}
                        </h1>
                        <p className="text-[10px] leading-snug text-slate-700">
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
                      <div className="text-[10px] font-bold tracking-wide text-slate-950 border border-slate-900 px-2.5 py-0.5 inline-block uppercase">
                        Official Certificate
                      </div>
                      <div className="text-[10.5px] text-slate-700 pt-1">
                        Date:{' '}
                        <strong className="font-mono-num text-slate-950">
                          {formatIndianDate(nocDate)}
                        </strong>
                      </div>
                      {nocRefNo.trim() && (
                        <div className="text-[10.5px] text-slate-700">
                          Ref No:{' '}
                          <strong className="font-mono-num text-slate-950">
                            {nocRefNo.trim()}
                          </strong>
                        </div>
                      )}
                    </div>
                  </header>

                  {/* Title */}
                  <div className="text-center my-7">
                    <h2 className="inline-block text-[15px] font-bold tracking-wide text-slate-950 uppercase border-b-2 border-slate-950 pb-1">
                      NO OBJECTION CERTIFICATE (NOC)
                    </h2>
                  </div>

                  {/* Customer Address Block if provided */}
                  {nocCustomerAddress.trim() && (
                    <div className="mb-6 text-[11px] leading-relaxed text-slate-800 border-l-2 border-slate-300 pl-3">
                      <div className="font-bold text-slate-950">
                        To: {nocCustomerName.trim() || '[Customer Name]'}
                      </div>
                      <div className="text-slate-600 whitespace-pre-line">
                        {nocCustomerAddress.trim()}
                      </div>
                    </div>
                  )}

                  {/* Formal Body Paragraphs */}
                  <div className="space-y-5 text-[11.5px] leading-[1.75] text-slate-800 text-justify">
                    <p>
                      This is to certify that{' '}
                      <strong className="text-slate-950">
                        M/s. / Mr. / Ms.{' '}
                        {nocCustomerName.trim() || '[Customer Name]'}
                      </strong>{' '}
                      (Ref / Loan A/c No:{' '}
                      <strong className="font-mono-num text-slate-950">
                        {nocLoanAccountNo.trim() || 'N/A'}
                      </strong>
                      ) had availed a loan / financial facility of{' '}
                      <strong className="font-mono-num text-slate-950">
                        {formatINR(nocAmountNum)}
                      </strong>{' '}
                      (
                      <strong className="text-slate-950">
                        {numberToIndianWords(nocAmountNum)}
                      </strong>
                      ) from{' '}
                      <strong className="text-slate-950">
                        {profile.companyName}
                      </strong>
                      .
                    </p>

                    <p>
                      We hereby confirm that the entire loan / outstanding amount of{' '}
                      <strong className="font-mono-num text-slate-950">
                        {formatINR(nocAmountNum)}
                      </strong>{' '}
                      has been fully repaid and settled on{' '}
                      <strong className="font-mono-num text-slate-950">
                        {formatIndianDate(nocRepaymentDate)}
                      </strong>{' '}
                      via{' '}
                      <strong className="text-slate-950">
                        {combinedNocPaymentMode}
                      </strong>
                      . As of date, there are{' '}
                      <strong className="text-slate-950 uppercase">
                        NO DUES
                      </strong>{' '}
                      pending against the said account/facility.
                    </p>

                    <p>
                      <strong className="text-slate-950">
                        {profile.companyName}
                      </strong>{' '}
                      has{' '}
                      <strong className="text-slate-950 uppercase">
                        NO OBJECTION
                      </strong>{' '}
                      whatsoever in releasing any lien, hypothecation, security, or
                      collateral held against the said facility.
                    </p>
                  </div>

                  {/* Structured Settlement Reference Grid */}
                  <div className="mt-8 border border-slate-300 bg-slate-50/70 p-4 rounded-xs">
                    <div className="text-[9.5px] font-bold uppercase tracking-wider text-slate-600 mb-2.5">
                      Account &amp; Closure Summary
                    </div>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[10.5px]">
                      <div>
                        <span className="text-slate-500">Party / Borrower:</span>{' '}
                        <strong className="text-slate-950">
                          {nocCustomerName.trim() || '—'}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Loan / Ref A/c No:</span>{' '}
                        <strong className="font-mono-num text-slate-950">
                          {nocLoanAccountNo.trim() || 'N/A'}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Settled Amount:</span>{' '}
                        <strong className="font-mono-num text-slate-950">
                          {formatINR(nocAmountNum)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500">Closure Date:</span>{' '}
                        <strong className="font-mono-num text-slate-950">
                          {formatIndianDate(nocRepaymentDate)}
                        </strong>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ) : (
              <article className="a4-sheet text-slate-900">
                <div>
                  {/* Company Letterhead Header */}
                  <header className="border-b-2 border-slate-900 pb-4 mb-5 flex items-start justify-between gap-4">
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
                        <h1 className="text-[15px] font-bold tracking-tight text-slate-950 uppercase leading-tight">
                          {profile.companyName}
                        </h1>
                        <p className="text-[10px] leading-snug text-slate-700">
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
                      <div className="text-[10px] font-bold tracking-wide text-slate-950 border border-slate-900 px-2.5 py-0.5 inline-block uppercase">
                        DD Cancellation
                      </div>
                      <div className="text-[10.5px] text-slate-700 pt-1">
                        Date:{' '}
                        <strong className="font-mono-num text-slate-950">
                          {formatIndianDate(ddLetterDate)}
                        </strong>
                      </div>
                      {ddRefNo.trim() && (
                        <div className="text-[10.5px] text-slate-700">
                          Ref No:{' '}
                          <strong className="font-mono-num text-slate-950">
                            {ddRefNo.trim()}
                          </strong>
                        </div>
                      )}
                    </div>
                  </header>

                  {/* To: Bank Branch Manager */}
                  <div className="mb-5 text-[11px] leading-snug space-y-0.5">
                    <div className="font-bold text-slate-950">To,</div>
                    <div className="font-bold text-slate-950">
                      The Branch Manager,
                    </div>
                    <div className="font-bold text-slate-950">
                      {ddBankName.trim() || '[Bank Name]'},
                    </div>
                    <div className="font-semibold text-slate-900">
                      {ddBranchName.trim() || '[Branch Name]'}.
                    </div>
                    {ddBranchAddress.trim() && (
                      <div className="text-[10px] text-slate-600 max-w-[65%]">
                        {ddBranchAddress.trim()}
                      </div>
                    )}
                  </div>

                  {/* Subject Line */}
                  <div className="bg-slate-100 border border-slate-300 px-3.5 py-2.5 mb-5 text-[11px] font-bold text-slate-950">
                    Sub: Request for Cancellation of Demand Draft (DD No:{' '}
                    <span className="font-mono-num">
                      {ddNumber.trim() || '[DD No]'}
                    </span>{' '}
                    dated{' '}
                    <span className="font-mono-num">
                      {formatIndianDate(ddDate)}
                    </span>{' '}
                    for{' '}
                    <span className="font-mono-num">
                      {formatINR(ddAmountNum)}
                    </span>
                    )
                  </div>

                  {/* Salutation & Body */}
                  <div className="space-y-4 text-[11px] leading-[1.65] text-slate-800">
                    <p className="font-medium text-slate-950">
                      Dear Sir / Madam,
                    </p>

                    <p className="text-justify">
                      With reference to the above subject, we request you to kindly
                      cancel the following Demand Draft issued from our Current /
                      OD Account No.{' '}
                      <strong className="font-mono-num text-slate-950">
                        {ddAccountNumber.trim() || '[Account Number]'}
                      </strong>{' '}
                      and credit the proceeds back to our said account at the
                      earliest:
                    </p>

                    {/* Bulleted / Tabular DD Particulars */}
                    <div className="border border-slate-400">
                      <table className="w-full border-collapse text-[10.5px]">
                        <tbody>
                          <tr className="border-b border-slate-300 bg-slate-50">
                            <td className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-300 w-[42%]">
                              • Demand Draft (DD) Number
                            </td>
                            <td className="py-2 px-3 font-mono-num font-bold text-slate-950">
                              {ddNumber.trim() || '—'}
                            </td>
                          </tr>
                          <tr className="border-b border-slate-300">
                            <td className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-300">
                              • DD Date
                            </td>
                            <td className="py-2 px-3 font-mono-num font-semibold text-slate-950">
                              {formatIndianDate(ddDate)}
                            </td>
                          </tr>
                          <tr className="border-b border-slate-300 bg-slate-50">
                            <td className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-300">
                              • DD Amount
                            </td>
                            <td className="py-2 px-3 text-slate-950">
                              <strong className="font-mono-num">
                                {formatINR(ddAmountNum)}
                              </strong>{' '}
                              <span className="text-slate-700">
                                ({numberToIndianWords(ddAmountNum)})
                              </span>
                            </td>
                          </tr>
                          <tr className="border-b border-slate-300">
                            <td className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-300">
                              • Issued in Favour of (Payee Name)
                            </td>
                            <td className="py-2 px-3 font-bold text-slate-950">
                              {ddPayeeName.trim() || '—'}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-300">
                              • Reason for Cancellation
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-950">
                              {ddReasonText.trim() ||
                                'DD not utilized / Purpose cancelled'}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    <p className="text-justify pt-1">
                      We are enclosing the <strong>Original Demand Draft</strong>{' '}
                      along with this letter for your verification and cancellation
                      processing. Kindly deduct any applicable bank cancellation
                      charges from our account.
                    </p>

                    <p className="pt-1 font-medium text-slate-950">
                      Thanking you,
                    </p>
                  </div>
                </div>
              </article>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
