import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CalendarDays,
  Check,
  Download,
  HardDriveDownload,
  Landmark,
  Layers,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CompanyBankAccount,
  CompanyWorkspace,
  CorporateProfile,
} from '../types/treasury';
import { formatIndianShort, formatINR } from '../utils/indianCurrency';

interface SettingsViewProps {
  companies: CompanyWorkspace[];
  activeCompanyId: string;
  profile: CorporateProfile;
  bankAccounts: CompanyBankAccount[];
  onSwitchCompany: (companyId: string) => void;
  onOpenAddCompany: () => void;
  onDeleteCompany: (companyId: string) => void;
  onSaveProfile: (profile: CorporateProfile) => void;
  onAddBankAccount: (account: Omit<CompanyBankAccount, 'id'>) => void;
  onUpdateBankAccount: (id: string, patch: Partial<CompanyBankAccount>) => void;
  onDeleteBankAccount: (id: string) => void;
  onResetDemoData: () => void;
  auditLogsCount?: number;
  onExportFullBackup: () => void;
  onRestoreBackupFile: (file: File) => void;
  bankHolidaysCount?: number;
  onOpenBankHolidays?: () => void;
}

export function SettingsView({
  companies,
  activeCompanyId,
  profile,
  bankAccounts,
  onSwitchCompany,
  onOpenAddCompany,
  onDeleteCompany,
  onSaveProfile,
  onAddBankAccount,
  onUpdateBankAccount,
  onDeleteBankAccount,
  onResetDemoData,
  auditLogsCount = 0,
  onExportFullBackup,
  onRestoreBackupFile,
  bankHolidaysCount = 0,
  onOpenBankHolidays,
}: SettingsViewProps) {
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [draftProfile, setDraftProfile] = useState<CorporateProfile>(profile);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    setDraftProfile(profile);
  }, [profile]);

  // Add Bank Account form state
  const [showAddBank, setShowAddBank] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountType, setAccountType] = useState<CompanyBankAccount['accountType']>('Current A/c');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscCode, setIfscCode] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [openingBalance, setOpeningBalance] = useState('0');
  const [confirmReset, setConfirmReset] = useState(false);

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSaveProfile(draftProfile);
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 3000);
  };

  const handleBankSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bankName.trim() || !accountNumber.trim() || !ifscCode.trim()) return;
    const parsedOpen = parseFloat(openingBalance.replace(/,/g, '')) || 0;
    onAddBankAccount({
      bankName: bankName.trim(),
      accountType,
      accountNumber: accountNumber.trim(),
      ifscCode: ifscCode.trim().toUpperCase(),
      branchName: branchName.trim() || 'Corporate Branch',
      branchAddress: branchAddress.trim() || 'Mumbai',
      isDefault: bankAccounts.length === 0,
      openingBalance: parsedOpen,
    });
    setBankName('');
    setAccountNumber('');
    setIfscCode('');
    setBranchName('');
    setBranchAddress('');
    setOpeningBalance('0');
    setShowAddBank(false);
  };

  const totalBatches = companies.reduce(
    (sum, c) => sum + (c.batches?.length || 0),
    0
  );
  const totalCheques = companies.reduce(
    (sum, c) => sum + (c.cheques?.length || 0),
    0
  );
  const totalDayBookEntries = companies.reduce(
    (sum, c) => sum + (c.dayBookEntries?.length || 0),
    0
  );

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Full Data Backup & Restore (JSON) */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <HardDriveDownload
              className="w-4 h-4 text-slate-800 mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Full Data Backup &amp; Restore (JSON)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Download a complete snapshot of all {companies.length}{' '}
                {companies.length === 1 ? 'company' : 'companies'},{' '}
                <span className="font-mono-num">{totalBatches}</span> batches,{' '}
                <span className="font-mono-num">{totalCheques}</span> cheques,{' '}
                <span className="font-mono-num">{totalDayBookEntries}</span> Day Book entries, customers, and{' '}
                <span className="font-mono-num">{auditLogsCount}</span> audit logs, or restore from a saved JSON backup.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onExportFullBackup}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0B192C] rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export Full Backup (JSON)</span>
            </button>

            <input
              ref={restoreInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onRestoreBackupFile(file);
                }
                e.target.value = '';
              }}
            />

            <button
              type="button"
              onClick={() => restoreInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Restore Backup (JSON)</span>
            </button>
          </div>
        </div>
      </section>

      {/* Bank Holiday Calendar & Auto-Shift Rules */}
      {onOpenBankHolidays && (
        <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <CalendarDays
              className="w-4 h-4 text-slate-800 mt-0.5 shrink-0"
              aria-hidden="true"
            />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Bank Holiday Calendar ({bankHolidaysCount} Configured)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                All Sundays, 2nd &amp; 4th Saturdays, and configured Indian / Tamil Nadu bank holidays automatically shift scheduled PDC/EMI deposit dates to the next working bank day.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenBankHolidays}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-slate-900 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Bank Holidays</span>
          </button>
        </section>
      )}

      {/* Multi-Company Directory */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Layers className="w-4 h-4 text-slate-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Corporate Entities ({companies.length})
              </h2>
              <p className="text-xs text-slate-500">
                Each company maintains its own isolated bank accounts, batches, cheque schedules, and A4 memo letterhead
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAddCompany}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Add New Company</span>
          </button>
        </div>

        <div className="divide-y divide-slate-200">
          {companies.map((comp) => {
            const isActive = comp.id === activeCompanyId;
            const totalValue = comp.cheques.reduce((s, c) => s + c.amount, 0);
            return (
              <div
                key={comp.id}
                className={`p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  isActive ? 'bg-slate-50/70' : ''
                }`}
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
                    <span>{comp.profile.companyName}</span>
                    {isActive && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <span className="text-xs font-semibold text-emerald-700">
                          Active Workspace
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>
                      PAN: <strong className="font-mono-num">{comp.profile.pan}</strong>
                    </span>
                    <span>
                      GSTIN: <strong className="font-mono-num">{comp.profile.gstin}</strong>
                    </span>
                    <span>{comp.bankAccounts.length} Bank Accounts</span>
                    <span>{comp.batches.length} Batches</span>
                    <span>
                      {comp.cheques.length} Cheques ({formatIndianShort(totalValue)})
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {!isActive && (
                    <button
                      type="button"
                      onClick={() => onSwitchCompany(comp.id)}
                      className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
                    >
                      Switch Active
                    </button>
                  )}
                  {companies.length > 1 && (
                    <button
                      type="button"
                      onClick={() => onDeleteCompany(comp.id)}
                      title="Remove Company Workspace"
                      className="p-2 text-slate-400 hover:text-red-700 rounded hover:bg-red-50 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Corporate Profile & Signatory Configuration */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-4 h-4 text-slate-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Corporate Entity &amp; Letterhead Profile
              </h2>
              <p className="text-xs text-slate-500">
                Appears on all official A4 Bank Deposit Memos and Tally/SAP exports
              </p>
            </div>
          </div>
          {savedNotice && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
              <Check className="w-3.5 h-3.5" />
              <span>Corporate profile saved</span>
            </span>
          )}
        </div>

        <form onSubmit={handleProfileSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Registered Corporate Name
              </label>
              <input
                type="text"
                value={draftProfile.companyName}
                onChange={(e) =>
                  setDraftProfile({ ...draftProfile, companyName: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Company PAN
                </label>
                <input
                  type="text"
                  maxLength={10}
                  value={draftProfile.pan}
                  onChange={(e) =>
                    setDraftProfile({
                      ...draftProfile,
                      pan: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  GSTIN
                </label>
                <input
                  type="text"
                  maxLength={15}
                  value={draftProfile.gstin}
                  onChange={(e) =>
                    setDraftProfile({
                      ...draftProfile,
                      gstin: e.target.value.toUpperCase(),
                    })
                  }
                  className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/15"
                  required
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Registered Office Address
            </label>
            <input
              type="text"
              value={draftProfile.registeredAddress}
              onChange={(e) =>
                setDraftProfile({
                  ...draftProfile,
                  registeredAddress: e.target.value,
                })
              }
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-900/15"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                CIN (Optional)
              </label>
              <input
                type="text"
                value={draftProfile.cin || ''}
                onChange={(e) =>
                  setDraftProfile({
                    ...draftProfile,
                    cin: e.target.value.toUpperCase(),
                  })
                }
                className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Treasury Contact Phone
              </label>
              <input
                type="text"
                value={draftProfile.contactPhone}
                onChange={(e) =>
                  setDraftProfile({ ...draftProfile, contactPhone: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Treasury Desk Email
              </label>
              <input
                type="email"
                value={draftProfile.treasuryEmail}
                onChange={(e) =>
                  setDraftProfile({ ...draftProfile, treasuryEmail: e.target.value })
                }
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
              />
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200">
            <h3 className="text-xs font-semibold text-slate-900 mb-3">
              Default Maker-Checker &amp; Bank Memo Authorized Signatories
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Authorized Signatory 1 (Name)
                </label>
                <input
                  type="text"
                  value={draftProfile.signatory1Name}
                  onChange={(e) =>
                    setDraftProfile({
                      ...draftProfile,
                      signatory1Name: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Authorized Signatory 1 (Designation)
                </label>
                <input
                  type="text"
                  value={draftProfile.signatory1Designation}
                  onChange={(e) =>
                    setDraftProfile({
                      ...draftProfile,
                      signatory1Designation: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Authorized Signatory 2 (Name)
                </label>
                <input
                  type="text"
                  value={draftProfile.signatory2Name}
                  onChange={(e) =>
                    setDraftProfile({
                      ...draftProfile,
                      signatory2Name: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Authorized Signatory 2 (Designation)
                </label>
                <input
                  type="text"
                  value={draftProfile.signatory2Designation}
                  onChange={(e) =>
                    setDraftProfile({
                      ...draftProfile,
                      signatory2Designation: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Maker / Checker Batch Bypass Password
                </label>
                <input
                  type="text"
                  value={draftProfile.checkerPassword ?? 'TREASURY2026'}
                  onChange={(e) =>
                    setDraftProfile({
                      ...draftProfile,
                      checkerPassword: e.target.value,
                    })
                  }
                  placeholder="Default: TREASURY2026"
                  className="w-full max-w-sm px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-md"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Required to unlock a locked clearing batch from read-only mode on the Dashboard.
                </p>
              </div>

              <div className="md:col-span-2 pt-2 border-t border-slate-100">
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Official Letterhead Logo (Optional PNG / JPG)
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  {draftProfile.logoDataUrl && (
                    <img
                      src={draftProfile.logoDataUrl}
                      alt="Company logo preview"
                      className="w-10 h-10 object-contain border border-slate-200 rounded bg-white p-0.5"
                    />
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === 'string') {
                          setDraftProfile({
                            ...draftProfile,
                            logoDataUrl: reader.result,
                          });
                        }
                      };
                      reader.readAsDataURL(file);
                    }}
                    className="text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:text-xs file:font-medium file:bg-white file:text-slate-700 hover:file:bg-slate-50"
                  />
                  {draftProfile.logoDataUrl && (
                    <button
                      type="button"
                      onClick={() =>
                        setDraftProfile({ ...draftProfile, logoDataUrl: undefined })
                      }
                      className="text-xs font-medium text-red-700 hover:text-red-900"
                    >
                      Remove Logo
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Appears on Official Returned Cheque Acknowledgement letters (uses corporate monogram if omitted).
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
            >
              Save Corporate Profile
            </button>
          </div>
        </form>
      </section>

      {/* Multi-Bank Treasury Accounts Manager */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <Landmark className="w-4 h-4 text-slate-700" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Company Bank Accounts ({bankAccounts.length})
              </h2>
              <p className="text-xs text-slate-500">
                Collection, Cash Credit &amp; Current Accounts configured for clearing deposits
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowAddBank((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Bank Account</span>
          </button>
        </div>

        {showAddBank && (
          <form
            onSubmit={handleBankSubmit}
            className="p-6 bg-slate-50 border-b border-slate-200 space-y-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bank Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. Axis Bank Ltd."
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Account Type
                </label>
                <select
                  value={accountType}
                  onChange={(e) =>
                    setAccountType(
                      e.target.value as CompanyBankAccount['accountType']
                    )
                  }
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                >
                  <option value="Cash Credit A/c">Cash Credit A/c</option>
                  <option value="Current A/c">Current A/c</option>
                  <option value="Collection A/c">Collection A/c</option>
                  <option value="Overdraft A/c">Overdraft A/c</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Account Number <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder="e.g. 91802004561823"
                  className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-md bg-white"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  IFSC Code <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  maxLength={11}
                  value={ifscCode}
                  onChange={(e) => setIfscCode(e.target.value.toUpperCase())}
                  placeholder="e.g. UTIB0000004"
                  className="w-full px-3 py-2 text-sm font-mono-num uppercase border border-slate-300 rounded-md bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Branch Name
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="e.g. Worli Corporate Branch"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Branch Address
                </label>
                <input
                  type="text"
                  value={branchAddress}
                  onChange={(e) => setBranchAddress(e.target.value)}
                  placeholder="Full branch address for deposit memo"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-md bg-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Opening Balance (₹)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={openingBalance}
                  onChange={(e) => setOpeningBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-md bg-white"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddBank(false)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800"
              >
                Save Account
              </button>
            </div>
          </form>
        )}

        <div className="divide-y divide-slate-200">
          {bankAccounts.map((acc) => (
            <div
              key={acc.id}
              className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2.5 text-sm font-semibold text-slate-900">
                  <span>{acc.bankName}</span>
                  <span className="text-slate-300" aria-hidden="true">·</span>
                  <span className="text-xs font-medium text-slate-600">
                    {acc.accountType}
                  </span>
                  {acc.isDefault && (
                    <>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-xs font-semibold text-emerald-700">
                        Primary Default
                      </span>
                    </>
                  )}
                </div>
                <div className="text-xs text-slate-600 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>
                    A/c No:{' '}
                    <strong className="font-mono-num text-slate-900">
                      {acc.accountNumber}
                    </strong>
                  </span>
                  <span>
                    IFSC:{' '}
                    <strong className="font-mono-num text-slate-900">
                      {acc.ifscCode}
                    </strong>
                  </span>
                  <span>Branch: {acc.branchName}</span>
                  <span>
                    Opening Bal:{' '}
                    <strong className="font-mono-num text-slate-900">
                      {formatINR(acc.openingBalance ?? 0)}
                    </strong>
                  </span>
                  {acc.statementClosingBalance !== undefined && (
                    <span>
                      Last Stmt Closing:{' '}
                      <strong className="font-mono-num text-slate-900">
                        {formatINR(acc.statementClosingBalance)}
                      </strong>
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500">{acc.branchAddress}</div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {!acc.isDefault && (
                  <button
                    type="button"
                    onClick={() => onUpdateBankAccount(acc.id, { isDefault: true })}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
                  >
                    Set Default
                  </button>
                )}
                {bankAccounts.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onDeleteBankAccount(acc.id)}
                    title="Remove Bank Account"
                    className="p-2 text-slate-400 hover:text-red-700 rounded hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Workspace Data Reset */}
      <section className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            Restore Sample Corporate Dataset
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Resets LocalStorage back to the initial 15 corporate cheques (~₹3.45 Cr) and 3 company bank accounts.
          </p>
        </div>
        {confirmReset ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onResetDemoData();
                setConfirmReset(false);
              }}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800"
            >
              Confirm Restore
            </button>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Demo Data</span>
          </button>
        )}
      </section>
    </div>
  );
}
