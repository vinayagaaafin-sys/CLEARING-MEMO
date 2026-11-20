import React, { useState } from 'react';
import { Building2, Landmark, Plus, X } from 'lucide-react';
import { MAJOR_INDIAN_BANKS } from '../data/indianBanks';
import {
  CompanyBankAccount,
  CompanyWorkspace,
  CorporateProfile,
} from '../types/treasury';
import { generateBatchRef } from '../utils/indianCurrency';

interface AddCompanyModalProps {
  onCreateCompany: (workspace: CompanyWorkspace) => void;
  onClose: () => void;
}

export function AddCompanyModal({
  onCreateCompany,
  onClose,
}: AddCompanyModalProps) {
  // Corporate Entity fields
  const [companyName, setCompanyName] = useState('');
  const [registeredAddress, setRegisteredAddress] = useState('');
  const [pan, setPan] = useState('');
  const [gstin, setGstin] = useState('');
  const [cin, setCin] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [treasuryEmail, setTreasuryEmail] = useState('');
  const [defaultMaker, setDefaultMaker] = useState('');
  const [defaultChecker, setDefaultChecker] = useState('');
  const [checkerPassword, setCheckerPassword] = useState('TREASURY2026');
  const [signatory1Name, setSignatory1Name] = useState('');
  const [signatory1Designation, setSignatory1Designation] = useState('Vice President – Finance');
  const [signatory2Name, setSignatory2Name] = useState('');
  const [signatory2Designation, setSignatory2Designation] = useState('Director & CFO');

  // Primary Bank Account fields
  const [bankName, setBankName] = useState('HDFC Bank Ltd.');
  const [accountType, setAccountType] =
    useState<CompanyBankAccount['accountType']>('Current A/c');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim() || !pan.trim() || !gstin.trim()) return;
    if (!bankName.trim() || !accountNumber.trim() || !ifscCode.trim()) return;

    const compId = `comp-${Date.now()}`;
    const bankId = `acc-${Date.now()}`;
    const batchId = `batch-${Date.now()}`;
    const today = new Date().toISOString().slice(0, 10);

    const profile: CorporateProfile = {
      companyName: companyName.trim(),
      registeredAddress: registeredAddress.trim(),
      pan: pan.trim().toUpperCase(),
      gstin: gstin.trim().toUpperCase(),
      cin: cin.trim().toUpperCase() || undefined,
      contactPhone: contactPhone.trim(),
      treasuryEmail: treasuryEmail.trim(),
      defaultMaker: defaultMaker.trim() || 'Treasury Executive',
      defaultChecker: defaultChecker.trim() || 'Finance Controller',
      checkerPassword: checkerPassword.trim() || 'TREASURY2026',
      signatory1Name:
        signatory1Name.trim() || defaultChecker.trim() || 'Authorized Signatory',
      signatory1Designation: signatory1Designation.trim() || 'Authorized Signatory',
      signatory2Name: signatory2Name.trim() || 'Director',
      signatory2Designation: signatory2Designation.trim() || 'Director',
    };

    const primaryBank: CompanyBankAccount = {
      id: bankId,
      bankName: bankName.trim(),
      accountType,
      accountNumber: accountNumber.trim(),
      ifscCode: ifscCode.trim().toUpperCase(),
      branchName: branchName.trim() || 'Corporate Branch',
      branchAddress: branchAddress.trim() || 'Mumbai',
      isDefault: true,
    };

    const initialBatch = {
      id: batchId,
      batchRef: generateBatchRef(today, 1),
      depositDate: today,
      companyBankAccountId: bankId,
      makerName: profile.defaultMaker,
      checkerName: profile.defaultChecker,
      status: 'Draft' as const,
      isLocked: false,
      notes: 'Initial clearing schedule',
    };

    onCreateCompany({
      id: compId,
      profile,
      bankAccounts: [primaryBank],
      batches: [initialBatch],
      cheques: [],
      activeBatchId: batchId,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#102A43]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-company-modal-title"
    >
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-white border border-[#D9E2EC] rounded-lg shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] shrink-0">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-[#176B87]" aria-hidden="true" />
            <div>
              <h3
                id="add-company-modal-title"
                className="text-base font-semibold text-[#102A43]"
              >
                Add New Corporate Entity
              </h3>
              <p className="text-xs text-[#627D98]">
                Creates an isolated treasury workspace with its own bank accounts, batches, cheques, and A4 memo letterhead
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#627D98] hover:text-[#102A43] rounded hover:bg-[#D9E2EC]/50 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="overflow-y-auto p-6 space-y-6"
        >
          {/* Section 1: Corporate Details */}
          <div className="space-y-4">
            <div className="text-xs font-semibold text-[#102A43] border-b border-[#D9E2EC] pb-1.5">
              01. Corporate Entity &amp; Letterhead Details
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Registered Company Name <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Apex Industrial Logistics Pvt. Ltd."
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    Company PAN <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={10}
                    value={pan}
                    onChange={(e) => setPan(e.target.value.toUpperCase())}
                    placeholder="AAACA1234B"
                    className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#243B53] mb-1">
                    GSTIN <span className="text-[#DC2626]">*</span>
                  </label>
                  <input
                    type="text"
                    maxLength={15}
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="27AAACA1234B1Z5"
                    className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                    required
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#243B53] mb-1">
                Registered Office Address <span className="text-[#DC2626]">*</span>
              </label>
              <input
                type="text"
                value={registeredAddress}
                onChange={(e) => setRegisteredAddress(e.target.value)}
                placeholder="Plot / Street, Industrial Estate / City, State – PIN Code"
                className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  CIN (Optional)
                </label>
                <input
                  type="text"
                  value={cin}
                  onChange={(e) => setCin(e.target.value.toUpperCase())}
                  placeholder="U63010MH2018PTC..."
                  className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Treasury Contact Phone
                </label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+91 22 4000 1200"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Treasury Desk Email
                </label>
                <input
                  type="email"
                  value={treasuryEmail}
                  onChange={(e) => setTreasuryEmail(e.target.value)}
                  placeholder="treasury@company.co.in"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Default Maker (Prepared By)
                </label>
                <input
                  type="text"
                  value={defaultMaker}
                  onChange={(e) => setDefaultMaker(e.target.value)}
                  placeholder="e.g. Suresh Nair (Treasury Exec.)"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Default Checker (Approved By)
                </label>
                <input
                  type="text"
                  value={defaultChecker}
                  onChange={(e) => setDefaultChecker(e.target.value)}
                  placeholder="e.g. Meera Iyer (Head Finance)"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Batch Lock Bypass Password
                </label>
                <input
                  type="text"
                  value={checkerPassword}
                  onChange={(e) => setCheckerPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Authorized Signatory 1 (Name)
                </label>
                <input
                  type="text"
                  value={signatory1Name}
                  onChange={(e) => setSignatory1Name(e.target.value)}
                  placeholder="e.g. Meera Iyer"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Authorized Signatory 2 (Name)
                </label>
                <input
                  type="text"
                  value={signatory2Name}
                  onChange={(e) => setSignatory2Name(e.target.value)}
                  placeholder="e.g. Arvind Kapoor"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Primary Deposit Bank Account */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-[#102A43] border-b border-[#D9E2EC] pb-1.5">
              <Landmark className="w-3.5 h-3.5 text-[#176B87]" />
              <span>02. Primary Company Bank Account</span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {MAJOR_INDIAN_BANKS.slice(0, 8).map((b) => (
                <button
                  key={b.shortCode}
                  type="button"
                  onClick={() => {
                    setBankName(b.name);
                    if (!branchName.trim()) setBranchName(b.sampleBranch);
                  }}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded border transition-colors ${
                    bankName === b.name
                      ? 'bg-[#102A43] text-white border-[#102A43]'
                      : 'bg-[#F4F7FA] text-[#243B53] border-[#D9E2EC] hover:border-[#176B87] hover:text-[#102A43]'
                  }`}
                >
                  {b.shortCode}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Bank Name <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Account Type
                </label>
                <select
                  value={accountType}
                  onChange={(e) =>
                    setAccountType(
                      e.target.value as CompanyBankAccount['accountType']
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                >
                  <option value="Current A/c">Current A/c</option>
                  <option value="Cash Credit A/c">Cash Credit A/c</option>
                  <option value="Collection A/c">Collection A/c</option>
                  <option value="Overdraft A/c">Overdraft A/c</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Account Number <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="e.g. 50200091827450"
                  className="w-full px-3 py-2 text-sm font-mono-num border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  IFSC Code <span className="text-[#DC2626]">*</span>
                </label>
                <input
                  type="text"
                  maxLength={11}
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                  placeholder="e.g. HDFC0000104"
                  className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Branch Name
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="e.g. BKC Corporate, Mumbai"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#243B53] mb-1">
                  Branch Address
                </label>
                <input
                  type="text"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  placeholder="Full bank branch address"
                  className="w-full px-3 py-2 text-sm border border-[#D9E2EC] rounded-md bg-white text-[#102A43] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#D9E2EC]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-semibold text-[#102A43] bg-[#14B8A6] rounded-md hover:bg-[#0D9488] transition-colors"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Create Company Workspace</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
