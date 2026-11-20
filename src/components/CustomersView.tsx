import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarCheck2,
  Camera,
  Check,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileText,
  History,
  Image as ImageIcon,
  Lock,
  Mail,
  MapPin,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  Search,
  Share2,
  ShieldAlert,
  Trash2,
  Upload,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  downloadDocumentBlob,
  formatFileSize,
  saveDocumentBlob,
} from '../services/documentBlobStore';
import {
  CompanyWorkspace,
  CustomerDocument,
  CustomerDocumentType,
  CustomerProfile,
  SystemAuditLogEntry,
  UserRole,
} from '../types/treasury';
import { formatAuditTimestamp } from '../utils/auditHelpers';
import {
  buildCustomerDirectory,
  CUSTOMER_DOCUMENT_TYPES,
  CustomerSummaryItem,
  getCustomerAuditLogs,
  getCustomerKey,
  inferDocumentMimeType,
  isAcceptedDocumentFile,
  resolveInstallmentPaidInfo,
} from '../utils/customerHelpers';
import {
  formatIndianDate,
  formatIndianShort,
  formatINR,
} from '../utils/indianCurrency';
import {
  computeScheduleRowsWithBalance,
  getFrequencyLabel,
  getInterestTypeLabel,
  round2,
} from '../utils/loanCalculator';
import { generateCustomerStatementPdf } from '../utils/pdfCustomerStatementGenerator';
import { ActivityTimeline } from './ActivityTimeline';
import { DocumentPreviewModal } from './DocumentPreviewModal';
import { StatusTag } from './StatusTag';
import { WhatsAppShareModal } from './WhatsAppShareModal';

export interface CustomerInitialSelection {
  customerKey?: string;
  tab?: 'loans' | 'documents' | 'cheques' | 'audit';
  linkChequeId?: string;
}

interface QueuedUploadItem {
  tempId: string;
  file: File;
  title: string;
  docType: CustomerDocumentType;
  note: string;
  linkedChequeId: string;
}

interface CustomersViewProps {
  company: CompanyWorkspace;
  auditLogs: SystemAuditLogEntry[];
  currentUserRole: UserRole;
  currentActorName: string;
  initialSelection?: CustomerInitialSelection | null;
  onClearInitialSelection?: () => void;
  onSaveCustomerProfile: (profile: CustomerProfile) => void;
  onUploadDocuments: (docs: CustomerDocument[]) => void;
  onDeleteDocument: (doc: CustomerDocument) => void;
  onRecordDocumentShare: (params: {
    customerKey: string;
    customerName: string;
    documents: CustomerDocument[];
    recipientPhone: string;
    channel: 'WhatsApp Web' | 'Direct File Share' | 'Copy Link';
  }) => void;
}

export function CustomersView({
  company,
  auditLogs,
  currentUserRole,
  currentActorName,
  initialSelection,
  onClearInitialSelection,
  onSaveCustomerProfile,
  onUploadDocuments,
  onDeleteDocument,
  onRecordDocumentShare,
}: CustomersViewProps) {
  const customers = useMemo(() => buildCustomerDirectory(company), [company]);
  const batchMap = useMemo(
    () => new Map(company.batches.map((b) => [b.id, b])),
    [company.batches]
  );
  const chequeById = useMemo(
    () => new Map(company.cheques.map((c) => [c.id, c])),
    [company.cheques]
  );

  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string>(
    initialSelection?.customerKey || customers[0]?.customerKey || ''
  );
  const [activeTab, setActiveTab] = useState<
    'loans' | 'documents' | 'cheques' | 'audit'
  >(initialSelection?.tab || 'loans');
  const [directorySearch, setDirectorySearch] = useState('');
  const [directoryFilter, setDirectoryFilter] = useState<
    'ALL' | 'WITH_DOCS' | 'RETURNED'
  >('ALL');

  // Add customer modal state
  const [showAddCustomer, setShowAddCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustCode, setNewCustCode] = useState('');
  const [newCustMobile, setNewCustMobile] = useState('');
  const [newCustEmail, setNewCustEmail] = useState('');
  const [newCustContact, setNewCustContact] = useState('');

  // Edit active customer profile inline
  const [editingProfile, setEditingProfile] = useState(false);
  const [draftProfile, setDraftProfile] = useState<CustomerProfile | null>(null);

  // Upload queue state
  const [queuedFiles, setQueuedFiles] = useState<QueuedUploadItem[]>([]);
  const [defaultLinkedChequeId, setDefaultLinkedChequeId] = useState<string>(
    initialSelection?.linkChequeId || ''
  );
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isSavingUploads, setIsSavingUploads] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Document filtering & selection
  const [docSearch, setDocSearch] = useState('');
  const [docTypeFilter, setDocTypeFilter] = useState<string>('ALL');
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [confirmDeleteDocId, setConfirmDeleteDocId] = useState<string | null>(
    null
  );

  // Modals
  const [previewDoc, setPreviewDoc] = useState<CustomerDocument | null>(null);
  const [shareDocs, setShareDocs] = useState<CustomerDocument[] | null>(null);

  useEffect(() => {
    if (initialSelection?.customerKey) {
      setSelectedCustomerKey(initialSelection.customerKey);
      if (initialSelection.tab) setActiveTab(initialSelection.tab);
      if (initialSelection.linkChequeId !== undefined) {
        setDefaultLinkedChequeId(initialSelection.linkChequeId);
      }
      onClearInitialSelection?.();
    }
  }, [initialSelection, onClearInitialSelection]);

  useEffect(() => {
    if (
      customers.length > 0 &&
      !customers.some((c) => c.customerKey === selectedCustomerKey)
    ) {
      setSelectedCustomerKey(customers[0].customerKey);
    }
  }, [customers, selectedCustomerKey]);

  const activeCustomer: CustomerSummaryItem | undefined = useMemo(
    () =>
      customers.find((c) => c.customerKey === selectedCustomerKey) ||
      customers[0],
    [customers, selectedCustomerKey]
  );

  // Reset per-customer transient UI when switching customer
  useEffect(() => {
    setEditingProfile(false);
    setDraftProfile(null);
    setSelectedDocIds([]);
    setConfirmDeleteDocId(null);
    setUploadError(null);
  }, [selectedCustomerKey]);

  const filteredDirectory = useMemo(() => {
    const q = directorySearch.trim().toLowerCase();
    return customers.filter((item) => {
      if (directoryFilter === 'WITH_DOCS' && item.documents.length === 0) {
        return false;
      }
      if (directoryFilter === 'RETURNED' && item.returnedCount === 0) {
        return false;
      }
      if (!q) return true;
      const hay = [
        item.profile.partyName,
        item.profile.customerCode,
        item.profile.mobileNumber,
        item.profile.contactPerson || '',
        ...item.cheques.map((c) => c.chequeNumber),
        ...item.schedules.map((s) => s.loanRefNo),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [customers, directorySearch, directoryFilter]);

  const handleDownloadCustomerPdf = (customer: CustomerSummaryItem) => {
    const { filename } = generateCustomerStatementPdf(company, customer);
    setActionNotice(
      `Downloaded PDF statement "${filename}" for ${customer.profile.partyName}.`
    );
  };

  const customerDocs = useMemo(() => {
    if (!activeCustomer) return [];
    const q = docSearch.trim().toLowerCase();
    return [...activeCustomer.documents]
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .filter((doc) => {
        if (docTypeFilter !== 'ALL' && doc.docType !== docTypeFilter) {
          return false;
        }
        if (!q) return true;
        const hay = `${doc.title} ${doc.docType} ${doc.fileName} ${doc.note || ''} ${doc.linkedChequeNumber || ''} ${doc.linkedBatchRef || ''} ${doc.uploadedBy}`.toLowerCase();
        return hay.includes(q);
      });
  }, [activeCustomer, docSearch, docTypeFilter]);

  const customerAuditEntries = useMemo(() => {
    if (!activeCustomer) return [];
    return getCustomerAuditLogs(
      company,
      auditLogs,
      activeCustomer.customerKey,
      activeCustomer.profile.partyName
    );
  }, [company, auditLogs, activeCustomer]);

  const queueFilesForUpload = (fileList: FileList | File[]) => {
    setUploadError(null);
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;

    const rejected: string[] = [];
    const accepted: QueuedUploadItem[] = [];

    for (const file of incoming) {
      if (!isAcceptedDocumentFile(file)) {
        rejected.push(file.name);
        continue;
      }
      const baseName = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
      const lower = file.name.toLowerCase();
      let suggestedType: CustomerDocumentType = 'Scanned Cheque Copy';
      if (lower.includes('memo') || lower.includes('return')) {
        suggestedType = 'Return Memo';
      } else if (lower.includes('kyc') || lower.includes('pan') || lower.includes('aadhar') || lower.includes('id')) {
        suggestedType = 'KYC / ID Proof';
      } else if (lower.includes('agree') || lower.includes('contract')) {
        suggestedType = 'Agreement';
      } else if (lower.includes('ack') || lower.includes('signed')) {
        suggestedType = 'Signed Acknowledgement';
      }

      accepted.push({
        tempId: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        title: baseName || file.name,
        docType: suggestedType,
        note: '',
        linkedChequeId: defaultLinkedChequeId || '',
      });
    }

    if (rejected.length > 0) {
      setUploadError(
        `Unsupported format skipped (${rejected.join(', ')}). Only PDF, JPG, PNG, and JPEG files are supported.`
      );
    }

    if (accepted.length > 0) {
      setQueuedFiles((prev) => [...prev, ...accepted]);
    }
  };

  const handleSaveQueuedUploads = async () => {
    if (!activeCustomer || queuedFiles.length === 0) return;
    setIsSavingUploads(true);
    setUploadError(null);

    try {
      const now = new Date().toISOString();
      const createdDocs: CustomerDocument[] = [];

      for (const item of queuedFiles) {
        const docId = `cdoc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const mimeType = inferDocumentMimeType(item.file);
        await saveDocumentBlob(docId, item.file, item.file.name, mimeType);

        const linkedChq = activeCustomer.cheques.find(
          (c) => c.id === item.linkedChequeId
        );
        const linkedBatch = linkedChq
          ? batchMap.get(linkedChq.batchId)
          : undefined;

        createdDocs.push({
          id: docId,
          companyId: company.id,
          customerKey: activeCustomer.customerKey,
          customerCode: activeCustomer.profile.customerCode,
          customerName: activeCustomer.profile.partyName,
          linkedChequeId: linkedChq?.id,
          linkedChequeNumber: linkedChq?.chequeNumber,
          linkedBatchId: linkedBatch?.id,
          linkedBatchRef: linkedBatch?.batchRef,
          title: item.title.trim() || item.file.name,
          docType: item.docType,
          note: item.note.trim() || undefined,
          fileName: item.file.name,
          mimeType,
          fileSize: item.file.size,
          uploadedAt: now,
          uploadedBy: `${currentActorName} (${currentUserRole})`,
          shareToken: Math.random().toString(36).slice(2, 12).toUpperCase(),
          shareCount: 0,
        });
      }

      onUploadDocuments(createdDocs);
      setQueuedFiles([]);
      setDefaultLinkedChequeId('');
      setActionNotice(
        `${createdDocs.length} document${createdDocs.length === 1 ? '' : 's'} uploaded and linked to ${activeCustomer.profile.partyName}.`
      );
      setTimeout(() => setActionNotice(null), 4000);
    } catch (err) {
      setUploadError(
        err instanceof Error
          ? `Failed to store documents: ${err.message}`
          : 'Failed to store documents locally.'
      );
    } finally {
      setIsSavingUploads(false);
    }
  };

  const handleCreateCustomerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;
    const code =
      newCustCode.trim().toUpperCase() ||
      `CUST-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const prof: CustomerProfile = {
      id: `cust-${Date.now()}`,
      customerCode: code,
      partyName: newCustName.trim(),
      mobileNumber: newCustMobile.trim(),
      email: newCustEmail.trim() || undefined,
      contactPerson: newCustContact.trim() || undefined,
      updatedAt: new Date().toISOString(),
    };
    onSaveCustomerProfile(prof);
    const nextKey = getCustomerKey(prof.customerCode, prof.partyName);
    setSelectedCustomerKey(nextKey);
    setShowAddCustomer(false);
    setNewCustName('');
    setNewCustCode('');
    setNewCustMobile('');
    setNewCustEmail('');
    setNewCustContact('');
  };

  const handleStartEditProfile = () => {
    if (!activeCustomer) return;
    setDraftProfile({ ...activeCustomer.profile });
    setEditingProfile(true);
  };

  const handleSaveProfileEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draftProfile || !draftProfile.partyName.trim()) return;
    onSaveCustomerProfile({
      ...draftProfile,
      partyName: draftProfile.partyName.trim(),
      customerCode: draftProfile.customerCode.trim() || '—',
      mobileNumber: draftProfile.mobileNumber.trim(),
      updatedAt: new Date().toISOString(),
    });
    setEditingProfile(false);
    setActionNotice('Customer profile & WhatsApp contact updated.');
    setTimeout(() => setActionNotice(null), 3500);
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId)
        ? prev.filter((id) => id !== docId)
        : [...prev, docId]
    );
  };

  const allVisibleDocsSelected =
    customerDocs.length > 0 &&
    customerDocs.every((d) => selectedDocIds.includes(d.id));

  const toggleSelectAllDocs = () => {
    if (allVisibleDocsSelected) {
      setSelectedDocIds([]);
    } else {
      setSelectedDocIds(customerDocs.map((d) => d.id));
    }
  };

  const handleBulkWhatsAppShare = () => {
    const selected = customerDocs.filter((d) => selectedDocIds.includes(d.id));
    if (selected.length > 0) {
      setShareDocs(selected);
    }
  };

  return (
    <div className="space-y-5">
      {/* Top Action & Directory Strip */}
      <div className="bg-white border border-[#D9E2EC] rounded-lg p-4 flex flex-wrap items-center justify-between gap-4 shadow-xs">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-md bg-[#102A43] text-[#14B8A6] flex items-center justify-center shrink-0">
            <Users className="w-4 h-4" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-[#102A43]">
              Customer Profiles, Document Vault &amp; WhatsApp Desk
            </h1>
            <p className="text-xs text-[#627D98]">
              {customers.length} customers · {(company.documents || []).length}{' '}
              stored documents across {company.profile.companyName}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border ${
              currentUserRole === 'Admin'
                ? 'bg-[#16A34A]/10 border-[#16A34A]/30 text-[#16A34A]'
                : 'bg-[#F4F7FA] border-[#D9E2EC] text-[#243B53]'
            }`}
          >
            {currentUserRole === 'Admin' ? (
              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
            ) : (
              <Lock className="w-3 h-3 text-[#D4AF37]" aria-hidden="true" />
            )}
            <span>
              Session: {currentActorName} ({currentUserRole})
            </span>
          </span>
          <button
            type="button"
            onClick={() => setShowAddCustomer(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] hover:bg-[#0D9488] rounded-md transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Add Customer Profile</span>
          </button>
        </div>
      </div>

      {/* Main Master-Detail Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left: Customer Directory */}
        <aside className="lg:col-span-4 bg-white border border-[#D9E2EC] rounded-lg overflow-hidden shadow-xs">
          <div className="p-3.5 border-b border-[#D9E2EC] bg-[#F4F7FA] space-y-2.5">
            <div className="relative">
              <Search
                className="w-3.5 h-3.5 text-[#627D98] absolute left-3 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="search"
                value={directorySearch}
                onChange={(e) => setDirectorySearch(e.target.value)}
                placeholder="Search customer, code, mobile, cheque #..."
                className="w-full pl-8 pr-3 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
              />
            </div>

            <div className="flex items-center gap-1.5 text-[11px]">
              {(
                [
                  { id: 'ALL', label: `All (${customers.length})` },
                  {
                    id: 'WITH_DOCS',
                    label: `With Docs (${customers.filter((c) => c.documents.length > 0).length})`,
                  },
                  {
                    id: 'RETURNED',
                    label: `Returned (${customers.filter((c) => c.returnedCount > 0).length})`,
                  },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setDirectoryFilter(f.id)}
                  className={`px-2.5 py-1 rounded font-medium transition-colors ${
                    directoryFilter === f.id
                      ? 'bg-[#102A43] text-white'
                      : 'bg-white border border-[#D9E2EC] text-[#627D98] hover:text-[#102A43]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-[#D9E2EC] max-h-[680px] overflow-y-auto">
            {filteredDirectory.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#627D98]">
                No customers match "{directorySearch}".
              </div>
            ) : (
              filteredDirectory.map((item) => {
                const isSelected =
                  item.customerKey === activeCustomer?.customerKey;
                return (
                  <div
                    key={item.customerKey}
                    className={`p-3.5 transition-colors flex items-start justify-between gap-2.5 ${
                      isSelected
                        ? 'bg-[#102A43] text-white'
                        : 'hover:bg-[#F4F7FA] text-[#102A43]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedCustomerKey(item.customerKey)}
                      className="flex-1 min-w-0 text-left flex flex-col gap-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-xs leading-snug">
                          {item.profile.partyName}
                        </div>
                        {item.documents.length > 0 && (
                          <span
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-num font-semibold shrink-0 ${
                              isSelected
                                ? 'bg-[#14B8A6]/20 text-[#14B8A6] border border-[#14B8A6]/40'
                                : 'bg-[#176B87]/10 text-[#176B87] border border-[#176B87]/25'
                            }`}
                          >
                            <Paperclip className="w-2.5 h-2.5" />
                            {item.documents.length}
                          </span>
                        )}
                      </div>

                      <div
                        className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono-num ${
                          isSelected ? 'text-[#D9E2EC]' : 'text-[#627D98]'
                        }`}
                      >
                        <span>{item.profile.customerCode}</span>
                        {item.schedules.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              {item.schedules.length} loan
                              {item.schedules.length === 1 ? '' : 's'} (
                              {formatIndianShort(item.loanSummary.unpaidBalance)}{' '}
                              bal)
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">·</span>
                        <span>
                          {item.cheques.length} chq
                          {item.cheques.length === 1 ? '' : 's'}
                        </span>
                        {item.totalAmount > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{formatIndianShort(item.totalAmount)}</span>
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span
                          className={`inline-flex items-center gap-1 font-mono-num ${
                            item.profile.mobileNumber
                              ? isSelected
                                ? 'text-[#14B8A6]'
                                : 'text-[#16A34A]'
                              : isSelected
                              ? 'text-[#D9E2EC]/70'
                              : 'text-[#627D98]'
                          }`}
                        >
                          <Phone className="w-2.5 h-2.5" aria-hidden="true" />
                          {item.profile.mobileNumber || 'No WhatsApp mobile'}
                        </span>
                        {item.returnedCount > 0 && (
                          <span
                            className={`text-[10px] font-semibold ${
                              isSelected ? 'text-[#FCA5A5]' : 'text-[#DC2626]'
                            }`}
                          >
                            {item.returnedCount} Returned
                          </span>
                        )}
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDownloadCustomerPdf(item)}
                      title={`Download PDF statement for ${item.profile.partyName}`}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded border shrink-0 whitespace-nowrap transition-colors ${
                        isSelected
                          ? 'bg-[#14B8A6] text-[#102A43] border-[#14B8A6] hover:bg-[#0D9488]'
                          : 'bg-white text-[#243B53] border-[#D9E2EC] hover:bg-[#F4F7FA] hover:text-[#102A43]'
                      }`}
                    >
                      <Download className="w-3 h-3" aria-hidden="true" />
                      <span>Download PDF</span>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        {/* Right: Customer Profile & Document Management Workspace */}
        <section className="lg:col-span-8 space-y-4">
          {!activeCustomer ? (
            <div className="bg-white border border-[#D9E2EC] rounded-lg p-10 text-center text-xs text-[#627D98] shadow-xs">
              Select or add a customer to view their profile, documents, and
              audit history.
            </div>
          ) : (
            <>
              {actionNotice && (
                <div
                  role="status"
                  className="flex items-center justify-between gap-3 px-4 py-2.5 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md text-xs text-[#102A43]"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                    <span>{actionNotice}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActionNotice(null)}
                    aria-label="Dismiss notice"
                    className="p-1 text-[#16A34A] hover:text-[#102A43]"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}

              {/* Customer Profile Summary Card */}
              <div className="bg-white border border-[#D9E2EC] rounded-lg p-5 space-y-4 shadow-xs">
                {editingProfile && draftProfile ? (
                  <form onSubmit={handleSaveProfileEdit} className="space-y-4">
                    <div className="flex items-center justify-between border-b border-[#D9E2EC] pb-2.5">
                      <h2 className="text-sm font-semibold text-[#102A43]">
                        Edit Customer Contact &amp; Profile Details
                      </h2>
                      <button
                        type="button"
                        onClick={() => setEditingProfile(false)}
                        className="text-xs text-[#627D98] hover:text-[#102A43]"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                      <div>
                        <label className="block font-medium text-[#243B53] mb-1">
                          Customer / Party Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={draftProfile.partyName}
                          onChange={(e) =>
                            setDraftProfile({
                              ...draftProfile,
                              partyName: e.target.value,
                            })
                          }
                          className="w-full px-3 py-1.5 border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-[#243B53] mb-1">
                          Customer Code
                        </label>
                        <input
                          type="text"
                          value={draftProfile.customerCode}
                          onChange={(e) =>
                            setDraftProfile({
                              ...draftProfile,
                              customerCode: e.target.value.toUpperCase(),
                            })
                          }
                          className="w-full px-3 py-1.5 font-mono-num uppercase border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-[#243B53] mb-1">
                          Saved WhatsApp Mobile Number
                        </label>
                        <input
                          type="tel"
                          value={draftProfile.mobileNumber}
                          onChange={(e) =>
                            setDraftProfile({
                              ...draftProfile,
                              mobileNumber: e.target.value,
                            })
                          }
                          placeholder="+91 98200 12345"
                          className="w-full px-3 py-1.5 font-mono-num border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-[#243B53] mb-1">
                          Contact Person
                        </label>
                        <input
                          type="text"
                          value={draftProfile.contactPerson || ''}
                          onChange={(e) =>
                            setDraftProfile({
                              ...draftProfile,
                              contactPerson: e.target.value,
                            })
                          }
                          placeholder="e.g. Suresh Menon (Finance)"
                          className="w-full px-3 py-1.5 border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-[#243B53] mb-1">
                          Email Address
                        </label>
                        <input
                          type="email"
                          value={draftProfile.email || ''}
                          onChange={(e) =>
                            setDraftProfile({
                              ...draftProfile,
                              email: e.target.value,
                            })
                          }
                          className="w-full px-3 py-1.5 border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                      <div>
                        <label className="block font-medium text-[#243B53] mb-1">
                          Office / Billing Address
                        </label>
                        <input
                          type="text"
                          value={draftProfile.address || ''}
                          onChange={(e) =>
                            setDraftProfile({
                              ...draftProfile,
                              address: e.target.value,
                            })
                          }
                          className="w-full px-3 py-1.5 border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingProfile(false)}
                        className="px-3.5 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA]"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] hover:bg-[#0D9488] rounded-md transition-colors"
                      >
                        Save Customer Profile
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h2 className="text-base font-bold text-[#102A43]">
                            {activeCustomer.profile.partyName}
                          </h2>
                          <span className="font-mono-num text-xs font-semibold px-2 py-0.5 rounded bg-[#F4F7FA] border border-[#D9E2EC] text-[#176B87]">
                            {activeCustomer.profile.customerCode}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#627D98]">
                          <span className="inline-flex items-center gap-1.5 font-mono-num">
                            <Phone
                              className="w-3.5 h-3.5 text-[#16A34A]"
                              aria-hidden="true"
                            />
                            <strong className="font-medium text-[#102A43]">
                              {activeCustomer.profile.mobileNumber ||
                                'No WhatsApp mobile saved'}
                            </strong>
                          </span>
                          {activeCustomer.profile.contactPerson && (
                            <span className="inline-flex items-center gap-1.5">
                              <User
                                className="w-3.5 h-3.5 text-[#627D98]"
                                aria-hidden="true"
                              />
                              <span>{activeCustomer.profile.contactPerson}</span>
                            </span>
                          )}
                          {activeCustomer.profile.email && (
                            <span className="inline-flex items-center gap-1.5">
                              <Mail
                                className="w-3.5 h-3.5 text-[#627D98]"
                                aria-hidden="true"
                              />
                              <span>{activeCustomer.profile.email}</span>
                            </span>
                          )}
                        </div>
                        {activeCustomer.profile.address && (
                          <div className="inline-flex items-center gap-1.5 text-[11px] text-[#627D98]">
                            <MapPin
                              className="w-3 h-3 text-[#627D98] shrink-0"
                              aria-hidden="true"
                            />
                            <span>{activeCustomer.profile.address}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDownloadCustomerPdf(activeCustomer)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-[#176B87] hover:bg-[#102A43] rounded-md transition-colors whitespace-nowrap"
                        >
                          <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Download PDF</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleStartEditProfile}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA] transition-colors whitespace-nowrap"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
                          <span>Edit Contact / Mobile</span>
                        </button>
                      </div>
                    </div>

                    {/* Customer KPI Strip */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-[#D9E2EC] text-xs">
                      <div className="bg-[#F4F7FA] border border-[#D9E2EC] rounded-md p-2.5">
                        <div className="text-[11px] text-[#627D98]">
                          {activeCustomer.schedules.length > 0
                            ? `Loan Payable (${activeCustomer.loanSummary.totalLoans})`
                            : 'Total Cheques'}
                        </div>
                        <div className="font-mono-num font-bold text-[#102A43] text-sm mt-0.5">
                          {activeCustomer.schedules.length > 0 ? (
                            <>
                              {formatIndianShort(
                                activeCustomer.loanSummary.totalPayable
                              )}{' '}
                              <span className="text-[11px] font-normal text-[#627D98]">
                                ({activeCustomer.loanSummary.paidInstallments}/
                                {activeCustomer.loanSummary.totalInstallments}{' '}
                                paid)
                              </span>
                            </>
                          ) : (
                            <>
                              {activeCustomer.cheques.length}{' '}
                              <span className="text-[11px] font-normal text-[#627D98]">
                                ({formatIndianShort(activeCustomer.totalAmount)})
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="bg-[#F4F7FA] border border-[#D9E2EC] rounded-md p-2.5">
                        <div className="text-[11px] text-[#627D98]">
                          {activeCustomer.schedules.length > 0
                            ? 'Outstanding Loan Balance'
                            : 'Returned Cheques'}
                        </div>
                        <div
                          className={`font-mono-num font-bold text-sm mt-0.5 ${
                            activeCustomer.schedules.length > 0
                              ? activeCustomer.loanSummary.unpaidBalance > 0
                                ? 'text-[#B45309]'
                                : 'text-[#16A34A]'
                              : activeCustomer.returnedCount > 0
                              ? 'text-[#DC2626]'
                              : 'text-[#102A43]'
                          }`}
                        >
                          {activeCustomer.schedules.length > 0 ? (
                            formatIndianShort(
                              activeCustomer.loanSummary.unpaidBalance
                            )
                          ) : (
                            <>
                              {activeCustomer.returnedCount}{' '}
                              <span className="text-[11px] font-normal text-[#627D98]">
                                (
                                {formatIndianShort(
                                  activeCustomer.returnedAmount
                                )}
                                )
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="bg-[#F4F7FA] border border-[#D9E2EC] rounded-md p-2.5">
                        <div className="text-[11px] text-[#627D98]">
                          {activeCustomer.schedules.length > 0
                            ? 'Total Paid (Installments)'
                            : 'Recovered Amount'}
                        </div>
                        <div className="font-mono-num font-bold text-[#16A34A] text-sm mt-0.5">
                          {formatIndianShort(
                            activeCustomer.schedules.length > 0
                              ? activeCustomer.loanSummary.paidAmount
                              : activeCustomer.recoveredAmount
                          )}
                        </div>
                      </div>
                      <div className="bg-[#14B8A6]/10 border border-[#14B8A6]/30 rounded-md p-2.5">
                        <div className="text-[11px] text-[#176B87] font-medium">
                          Cheques &amp; Vault Docs
                        </div>
                        <div className="font-mono-num font-bold text-[#102A43] text-sm mt-0.5">
                          {activeCustomer.cheques.length} Chq ·{' '}
                          {activeCustomer.documents.length} Files
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Customer Detail Tabs */}
              <div className="bg-white border border-[#D9E2EC] rounded-lg overflow-hidden shadow-xs">
                <div className="border-b border-[#D9E2EC] bg-[#F4F7FA] px-4 flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('loans')}
                    className={`inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                      activeTab === 'loans'
                        ? 'border-[#14B8A6] text-[#102A43]'
                        : 'border-transparent text-[#627D98] hover:text-[#102A43]'
                    }`}
                  >
                    <CalendarCheck2 className={`w-3.5 h-3.5 ${activeTab === 'loans' ? 'text-[#176B87]' : ''}`} aria-hidden="true" />
                    <span>
                      Loans &amp; Installments ({activeCustomer.schedules.length})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('documents')}
                    className={`inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                      activeTab === 'documents'
                        ? 'border-[#14B8A6] text-[#102A43]'
                        : 'border-transparent text-[#627D98] hover:text-[#102A43]'
                    }`}
                  >
                    <Paperclip className={`w-3.5 h-3.5 ${activeTab === 'documents' ? 'text-[#176B87]' : ''}`} aria-hidden="true" />
                    <span>
                      Documents / Attachments ({activeCustomer.documents.length})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('cheques')}
                    className={`inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                      activeTab === 'cheques'
                        ? 'border-[#14B8A6] text-[#102A43]'
                        : 'border-transparent text-[#627D98] hover:text-[#102A43]'
                    }`}
                  >
                    <FileText className={`w-3.5 h-3.5 ${activeTab === 'cheques' ? 'text-[#176B87]' : ''}`} aria-hidden="true" />
                    <span>
                      Cheque Ledger ({activeCustomer.cheques.length})
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('audit')}
                    className={`inline-flex items-center gap-1.5 px-4 py-3 text-xs font-semibold border-b-2 transition-colors ${
                      activeTab === 'audit'
                        ? 'border-[#14B8A6] text-[#102A43]'
                        : 'border-transparent text-[#627D98] hover:text-[#102A43]'
                    }`}
                  >
                    <History className={`w-3.5 h-3.5 ${activeTab === 'audit' ? 'text-[#176B87]' : ''}`} aria-hidden="true" />
                    <span>
                      Activity / Audit History ({customerAuditEntries.length})
                    </span>
                  </button>
                </div>

                {/* TAB 0: Customer Loans & Full Installment Payment History */}
                {activeTab === 'loans' && (
                  <div className="p-5 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-xs font-semibold text-[#102A43]">
                          Loan Summary &amp; Full Installment Payment History
                        </h3>
                        <p className="text-[11px] text-[#627D98] mt-0.5">
                          Showing all loan schemes and due schedules for{' '}
                          <strong className="text-[#243B53]">
                            {activeCustomer.profile.partyName}
                          </strong>
                          .
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDownloadCustomerPdf(activeCustomer)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[#243B53] bg-white border border-[#D9E2EC] hover:bg-[#F4F7FA] rounded-md transition-colors whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
                        <span>Download PDF Statement</span>
                      </button>
                    </div>

                    {activeCustomer.schedules.length === 0 ? (
                      <div className="border border-dashed border-[#D9E2EC] rounded-lg p-8 text-center text-xs text-[#627D98] bg-[#F4F7FA]/50">
                        No loan installment schedules found for{' '}
                        {activeCustomer.profile.partyName}. Create a new loan
                        schedule under <strong className="text-[#243B53]">Customer Schedule</strong> to
                        auto-generate dues and payment history here.
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {/* Aggregated Customer Loan KPI Bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                          <div className="p-3 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md">
                            <div className="text-[11px] text-[#627D98]">
                              Total Principal
                            </div>
                            <div className="font-mono-num font-bold text-[#102A43] mt-0.5">
                              {formatINR(
                                activeCustomer.loanSummary.totalPrincipal
                              )}
                            </div>
                          </div>
                          <div className="p-3 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md">
                            <div className="text-[11px] text-[#627D98]">
                              Total Interest
                            </div>
                            <div className="font-mono-num font-bold text-[#102A43] mt-0.5">
                              {formatINR(
                                activeCustomer.loanSummary.totalInterest
                              )}
                            </div>
                          </div>
                          <div className="p-3 bg-[#F4F7FA] border border-[#D9E2EC] rounded-md">
                            <div className="text-[11px] text-[#627D98]">
                              Total Payable
                            </div>
                            <div className="font-mono-num font-bold text-[#102A43] mt-0.5">
                              {formatINR(
                                activeCustomer.loanSummary.totalPayable
                              )}
                            </div>
                          </div>
                          <div className="p-3 bg-[#16A34A]/10 border border-[#16A34A]/30 rounded-md">
                            <div className="text-[11px] text-[#16A34A] font-medium">
                              Paid ({activeCustomer.loanSummary.paidInstallments}
                              /{activeCustomer.loanSummary.totalInstallments})
                            </div>
                            <div className="font-mono-num font-bold text-[#16A34A] mt-0.5">
                              {formatINR(activeCustomer.loanSummary.paidAmount)}
                            </div>
                          </div>
                          <div className="p-3 bg-[#102A43] text-white rounded-md">
                            <div className="text-[11px] text-[#D9E2EC]">
                              Outstanding Balance
                            </div>
                            <div className="font-mono-num font-bold text-[#14B8A6] mt-0.5">
                              {formatINR(
                                activeCustomer.loanSummary.unpaidBalance
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Individual Loan Schedule Cards */}
                        {activeCustomer.schedules.map((sch) => {
                          const rowsWithBal = computeScheduleRowsWithBalance(
                            sch.cheques || []
                          );
                          const schTotalPayable = round2(
                            sch.totalPayable ??
                              (sch.cheques || []).reduce(
                                (s, r) => s + (r.amount || 0),
                                0
                              )
                          );
                          const schPrincipal = round2(
                            sch.principalAmount ??
                              (sch.cheques || []).reduce(
                                (s, r) =>
                                  s + (r.principalAmount ?? r.amount ?? 0),
                                0
                              )
                          );
                          const schPaid = round2(
                            (sch.cheques || []).reduce((s, r) => {
                              const info = resolveInstallmentPaidInfo(
                                r,
                                chequeById
                              );
                              return info.isPaid ? s + (r.amount || 0) : s;
                            }, 0)
                          );
                          const schBal = Math.max(
                            0,
                            round2(schTotalPayable - schPaid)
                          );

                          return (
                            <div
                              key={sch.id}
                              className="border border-[#D9E2EC] rounded-lg overflow-hidden"
                            >
                              <div className="px-4 py-3 bg-[#F4F7FA] border-b border-[#D9E2EC] flex flex-wrap items-center justify-between gap-2 text-xs">
                                <div className="space-y-0.5">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="font-semibold text-[#102A43]">
                                      Loan Ref:{' '}
                                      <span className="font-mono-num text-[#176B87]">
                                        {sch.loanRefNo || sch.id.slice(-8)}
                                      </span>
                                    </span>
                                    {sch.frequency && (
                                      <span className="text-[11px] text-[#627D98]">
                                        · {getFrequencyLabel(sch.frequency)}
                                      </span>
                                    )}
                                    {sch.interestType && (
                                      <span className="text-[11px] text-[#627D98]">
                                        ·{' '}
                                        {getInterestTypeLabel(sch.interestType)}
                                        {sch.interestType !== 'ZERO_INTEREST'
                                          ? ` (${sch.interestRate ?? 0}%)`
                                          : ''}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-[#627D98]">
                                    {sch.draweeBank || 'Bank N/A'}
                                    {sch.draweeBranch
                                      ? ` (${sch.draweeBranch})`
                                      : ''}
                                    {sch.notes ? ` · ${sch.notes}` : ''}
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-3 font-mono-num text-[11px] text-[#627D98]">
                                  <span>
                                    Principal:{' '}
                                    <strong className="text-[#102A43]">
                                      {formatINR(schPrincipal)}
                                    </strong>
                                  </span>
                                  <span>
                                    Paid:{' '}
                                    <strong className="text-[#16A34A]">
                                      {formatINR(schPaid)}
                                    </strong>
                                  </span>
                                  <span>
                                    Remaining:{' '}
                                    <strong className="text-[#102A43]">
                                      {formatINR(schBal)}
                                    </strong>
                                  </span>
                                </div>
                              </div>

                              <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                  <thead>
                                    <tr className="border-b border-[#D9E2EC] bg-white text-[11px] font-semibold text-[#627D98]">
                                      <th className="py-2 px-3">Inst. #</th>
                                      <th className="py-2 px-3">Due Date</th>
                                      <th className="py-2 px-3">
                                        Deposit Date
                                      </th>
                                      <th className="py-2 px-3">Cheque #</th>
                                      <th className="py-2 px-3 text-right">
                                        Due Amount (₹)
                                      </th>
                                      <th className="py-2 px-3">Paid Status</th>
                                      <th className="py-2 px-3 text-right">
                                        Balance (₹)
                                      </th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-[#D9E2EC]">
                                    {rowsWithBal.map(
                                      ({ item, runningBalance }, idx) => {
                                        const paidInfo =
                                          resolveInstallmentPaidInfo(
                                            item,
                                            chequeById
                                          );
                                        return (
                                          <tr
                                            key={item.id}
                                            className="hover:bg-[#F4F7FA]/80"
                                          >
                                            <td className="py-2 px-3 font-mono-num text-[#627D98]">
                                              {item.dueNumber ?? idx + 1}
                                            </td>
                                            <td className="py-2 px-3 font-mono-num text-[#627D98] whitespace-nowrap">
                                              {formatIndianDate(
                                                item.originalDate
                                              )}
                                            </td>
                                            <td className="py-2 px-3 font-mono-num text-[#102A43] whitespace-nowrap">
                                              {formatIndianDate(
                                                item.effectiveDate
                                              )}
                                            </td>
                                            <td className="py-2 px-3 font-mono-num font-semibold text-[#176B87]">
                                              #{item.chequeNumber}
                                            </td>
                                            <td className="py-2 px-3 text-right font-mono-num font-semibold text-[#102A43]">
                                              {formatINR(item.amount)}
                                            </td>
                                            <td className="py-2 px-3 whitespace-nowrap">
                                              <span
                                                className={`text-[11px] font-semibold ${
                                                  paidInfo.isPaid
                                                    ? 'text-[#16A34A]'
                                                    : paidInfo.effectiveStatus ===
                                                      'Returned / Bounced'
                                                    ? 'text-[#DC2626]'
                                                    : paidInfo.effectiveStatus ===
                                                      'In Clearing'
                                                    ? 'text-[#2563EB]'
                                                    : 'text-[#64748B]'
                                                }`}
                                              >
                                                {paidInfo.paidLabel}
                                              </span>
                                            </td>
                                            <td className="py-2 px-3 text-right font-mono-num font-semibold text-[#102A43]">
                                              {formatINR(
                                                item.balance ?? runningBalance
                                              )}
                                            </td>
                                          </tr>
                                        );
                                      }
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* TAB 1: Documents & Attachments */}
                {activeTab === 'documents' && (
                  <div className="p-5 space-y-5">
                    {/* Upload Dropzone & Mobile Camera Capture */}
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsDragging(true);
                      }}
                      onDragLeave={() => setIsDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setIsDragging(false);
                        if (e.dataTransfer.files?.length) {
                          queueFilesForUpload(e.dataTransfer.files);
                        }
                      }}
                      className={`border-2 border-dashed rounded-lg p-5 transition-colors text-center space-y-3 ${
                        isDragging
                          ? 'border-[#14B8A6] bg-[#14B8A6]/10'
                          : 'border-[#D9E2EC] bg-[#F4F7FA]/70 hover:bg-[#F4F7FA]'
                      }`}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            queueFilesForUpload(e.target.files);
                            e.target.value = '';
                          }
                        }}
                        className="hidden"
                      />
                      <input
                        ref={cameraInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => {
                          if (e.target.files?.length) {
                            queueFilesForUpload(e.target.files);
                            e.target.value = '';
                          }
                        }}
                        className="hidden"
                      />

                      <div className="flex flex-col items-center gap-1.5">
                        <div className="w-10 h-10 rounded-full bg-white border border-[#D9E2EC] flex items-center justify-center text-[#176B87]">
                          <Upload className="w-4 h-4" aria-hidden="true" />
                        </div>
                        <div className="text-xs font-semibold text-[#102A43]">
                          Drag &amp; drop scanned documents here, or choose files
                        </div>
                        <p className="text-[11px] text-[#627D98]">
                          Supports multiple <strong className="text-[#243B53]">PDF, JPG, PNG, JPEG</strong>{' '}
                          files · Saved securely in browser document vault
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] hover:bg-[#0D9488] rounded-md transition-colors"
                        >
                          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Upload Files (PDF / Images)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => cameraInputRef.current?.click()}
                          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#243B53] bg-white border border-[#D9E2EC] hover:bg-[#F4F7FA] rounded-md transition-colors"
                        >
                          <Camera className="w-3.5 h-3.5 text-[#176B87]" aria-hidden="true" />
                          <span>Mobile Camera Scan</span>
                        </button>
                      </div>
                    </div>

                    {uploadError && (
                      <div className="flex items-start gap-2 p-3 bg-[#DC2626]/10 border border-[#DC2626]/30 rounded-md text-xs text-[#DC2626]">
                        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{uploadError}</span>
                      </div>
                    )}

                    {/* Staged Multi-File Metadata Editor */}
                    {queuedFiles.length > 0 && (
                      <div className="border border-[#D9E2EC] rounded-lg bg-[#F4F7FA] overflow-hidden">
                        <div className="px-4 py-3 border-b border-[#D9E2EC] bg-white flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-xs font-semibold text-[#102A43]">
                              Ready to Upload ({queuedFiles.length} file
                              {queuedFiles.length === 1 ? '' : 's'})
                            </h3>
                            <p className="text-[11px] text-[#627D98]">
                              Uploaded By:{' '}
                              <strong className="text-[#243B53]">
                                {currentActorName} ({currentUserRole})
                              </strong>
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setQueuedFiles([])}
                              className="px-2.5 py-1 text-xs font-medium text-[#627D98] hover:text-[#102A43]"
                            >
                              Clear Queue
                            </button>
                            <button
                              type="button"
                              disabled={isSavingUploads}
                              onClick={handleSaveQueuedUploads}
                              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-[#102A43] bg-[#14B8A6] hover:bg-[#0D9488] disabled:opacity-50 rounded-md transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>
                                {isSavingUploads
                                  ? 'Saving...'
                                  : `Save ${queuedFiles.length} Document${queuedFiles.length === 1 ? '' : 's'}`}
                              </span>
                            </button>
                          </div>
                        </div>

                        <div className="divide-y divide-[#D9E2EC]">
                          {queuedFiles.map((item) => (
                            <div
                              key={item.tempId}
                              className="p-4 grid grid-cols-1 md:grid-cols-12 gap-3 items-start text-xs"
                            >
                              <div className="md:col-span-4 space-y-1">
                                <label className="block text-[11px] font-medium text-[#627D98]">
                                  Document Title *
                                </label>
                                <input
                                  type="text"
                                  value={item.title}
                                  onChange={(e) =>
                                    setQueuedFiles((prev) =>
                                      prev.map((q) =>
                                        q.tempId === item.tempId
                                          ? { ...q, title: e.target.value }
                                          : q
                                      )
                                    )
                                  }
                                  className="w-full px-2.5 py-1.5 border border-[#D9E2EC] rounded bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                                />
                                <div className="text-[10px] font-mono-num text-[#627D98] truncate">
                                  {item.file.name} (
                                  {formatFileSize(item.file.size)})
                                </div>
                              </div>

                              <div className="md:col-span-3 space-y-1">
                                <label className="block text-[11px] font-medium text-[#627D98]">
                                  Document Type
                                </label>
                                <select
                                  value={item.docType}
                                  onChange={(e) =>
                                    setQueuedFiles((prev) =>
                                      prev.map((q) =>
                                        q.tempId === item.tempId
                                          ? {
                                              ...q,
                                              docType: e.target
                                                .value as CustomerDocumentType,
                                            }
                                          : q
                                      )
                                    )
                                  }
                                  className="w-full px-2.5 py-1.5 border border-[#D9E2EC] rounded bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                                >
                                  {CUSTOMER_DOCUMENT_TYPES.map((t) => (
                                    <option key={t} value={t}>
                                      {t}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              <div className="md:col-span-3 space-y-1">
                                <label className="block text-[11px] font-medium text-[#627D98]">
                                  Link to Cheque / Batch (Optional)
                                </label>
                                <select
                                  value={item.linkedChequeId}
                                  onChange={(e) =>
                                    setQueuedFiles((prev) =>
                                      prev.map((q) =>
                                        q.tempId === item.tempId
                                          ? {
                                              ...q,
                                              linkedChequeId: e.target.value,
                                            }
                                          : q
                                      )
                                    )
                                  }
                                  className="w-full px-2.5 py-1.5 border border-[#D9E2EC] rounded bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                                >
                                  <option value="">General Customer Doc</option>
                                  {activeCustomer.cheques.map((chq) => {
                                    const batch = batchMap.get(chq.batchId);
                                    return (
                                      <option key={chq.id} value={chq.id}>
                                        Chq #{chq.chequeNumber} (
                                        {formatINR(chq.amount, false)}) ·{' '}
                                        {batch?.batchRef || 'Batch'}
                                      </option>
                                    );
                                  })}
                                </select>
                              </div>

                              <div className="md:col-span-2 flex items-end gap-1.5">
                                <div className="flex-1 space-y-1">
                                  <label className="block text-[11px] font-medium text-[#627D98]">
                                    Note
                                  </label>
                                  <input
                                    type="text"
                                    value={item.note}
                                    onChange={(e) =>
                                      setQueuedFiles((prev) =>
                                        prev.map((q) =>
                                          q.tempId === item.tempId
                                            ? { ...q, note: e.target.value }
                                            : q
                                        )
                                      )
                                    }
                                    placeholder="Optional"
                                    className="w-full px-2 py-1.5 border border-[#D9E2EC] rounded bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setQueuedFiles((prev) =>
                                      prev.filter(
                                        (q) => q.tempId !== item.tempId
                                      )
                                    )
                                  }
                                  aria-label="Remove queued file"
                                  className="p-1.5 text-[#627D98] hover:text-[#DC2626] rounded hover:bg-[#DC2626]/10"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Stored Documents Filter & Bulk Share Bar */}
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
                          <div className="relative flex-1 min-w-[180px] max-w-xs">
                            <Search
                              className="w-3.5 h-3.5 text-[#627D98] absolute left-2.5 top-1/2 -translate-y-1/2"
                              aria-hidden="true"
                            />
                            <input
                              type="search"
                              value={docSearch}
                              onChange={(e) => setDocSearch(e.target.value)}
                              placeholder="Search title, cheque #, note..."
                              className="w-full pl-8 pr-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] placeholder:text-[#627D98] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                            />
                          </div>
                          <select
                            aria-label="Filter documents by type"
                            value={docTypeFilter}
                            onChange={(e) => setDocTypeFilter(e.target.value)}
                            className="px-2.5 py-1.5 text-xs border border-[#D9E2EC] rounded-md bg-white text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                          >
                            <option value="ALL">All Document Types</option>
                            {CUSTOMER_DOCUMENT_TYPES.map((t) => (
                              <option key={t} value={t}>
                                {t}
                              </option>
                            ))}
                          </select>
                        </div>

                        {selectedDocIds.length > 0 && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={handleBulkWhatsAppShare}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-md transition-colors"
                            >
                              <MessageCircle className="w-3.5 h-3.5" />
                              <span>
                                Share Selected via WhatsApp (
                                {selectedDocIds.length})
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setSelectedDocIds([])}
                              className="text-xs text-[#627D98] hover:text-[#102A43] px-2 py-1"
                            >
                              Clear
                            </button>
                          </div>
                        )}
                      </div>

                      {customerDocs.length === 0 ? (
                        <div className="border border-dashed border-[#D9E2EC] rounded-lg p-8 text-center text-xs text-[#627D98] bg-[#F4F7FA]/50">
                          {activeCustomer.documents.length === 0
                            ? `No documents attached for ${activeCustomer.profile.partyName} yet. Upload scanned cheques, return memos, KYC proofs, or signed acknowledgements above.`
                            : 'No documents match your search or category filter.'}
                        </div>
                      ) : (
                        <div className="border border-[#D9E2EC] rounded-lg overflow-hidden">
                          <div className="px-4 py-2 bg-[#F4F7FA] border-b border-[#D9E2EC] flex items-center justify-between text-[11px] font-semibold text-[#627D98]">
                            <label className="inline-flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={allVisibleDocsSelected}
                                onChange={toggleSelectAllDocs}
                                className="rounded border-[#D9E2EC] text-[#14B8A6] focus:ring-[#14B8A6]"
                              />
                              <span>
                                Select All ({customerDocs.length} Document
                                {customerDocs.length === 1 ? '' : 's'})
                              </span>
                            </label>
                            {currentUserRole !== 'Admin' && (
                              <span className="inline-flex items-center gap-1 text-[#627D98] font-normal">
                                <ShieldAlert className="w-3 h-3 text-[#F59E0B]" />
                                Switch session to Admin in top bar to delete
                                documents
                              </span>
                            )}
                          </div>

                          <div className="divide-y divide-[#D9E2EC]">
                            {customerDocs.map((doc) => {
                              const isPdf =
                                doc.mimeType === 'application/pdf' ||
                                doc.fileName.toLowerCase().endsWith('.pdf');
                              const isSelected = selectedDocIds.includes(
                                doc.id
                              );
                              const isConfirmingDelete =
                                confirmDeleteDocId === doc.id;

                              return (
                                <div
                                  key={doc.id}
                                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[#F4F7FA]/70 transition-colors"
                                >
                                  <div className="flex items-start gap-3 min-w-0">
                                    <input
                                      type="checkbox"
                                      aria-label={`Select ${doc.title}`}
                                      checked={isSelected}
                                      onChange={() =>
                                        toggleDocSelection(doc.id)
                                      }
                                      className="mt-1 rounded border-[#D9E2EC] text-[#14B8A6] focus:ring-[#14B8A6]"
                                    />
                                    <div
                                      className={`w-9 h-9 rounded-md border flex items-center justify-center shrink-0 ${
                                        isPdf
                                          ? 'bg-[#DC2626]/10 border-[#DC2626]/30 text-[#DC2626]'
                                          : 'bg-[#176B87]/10 border-[#176B87]/30 text-[#176B87]'
                                      }`}
                                    >
                                      {isPdf ? (
                                        <FileText className="w-4 h-4" />
                                      ) : (
                                        <ImageIcon className="w-4 h-4" />
                                      )}
                                    </div>
                                    <div className="min-w-0 space-y-1">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs font-semibold text-[#102A43]">
                                          {doc.title}
                                        </span>
                                        <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#F4F7FA] border border-[#D9E2EC] text-[#243B53]">
                                          {doc.docType}
                                        </span>
                                        {doc.linkedChequeNumber && (
                                          <span className="font-mono-num text-[11px] font-medium text-[#176B87] bg-[#176B87]/10 border border-[#176B87]/25 px-2 py-0.5 rounded">
                                            Chq #{doc.linkedChequeNumber}
                                            {doc.linkedBatchRef
                                              ? ` · ${doc.linkedBatchRef}`
                                              : ''}
                                          </span>
                                        )}
                                      </div>

                                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#627D98]">
                                        <span className="font-mono-num">
                                          {doc.fileName} (
                                          {formatFileSize(doc.fileSize)})
                                        </span>
                                        <span aria-hidden="true">·</span>
                                        <span>
                                          Uploaded{' '}
                                          {formatAuditTimestamp(doc.uploadedAt)}{' '}
                                          by{' '}
                                          <strong className="font-medium text-[#243B53]">
                                            {doc.uploadedBy}
                                          </strong>
                                        </span>
                                        {(doc.shareCount ?? 0) > 0 && (
                                          <>
                                            <span aria-hidden="true">·</span>
                                            <span className="text-[#16A34A] font-medium">
                                              Shared {doc.shareCount}x
                                              {doc.lastSharedTo
                                                ? ` (${doc.lastSharedTo})`
                                                : ''}
                                            </span>
                                          </>
                                        )}
                                      </div>

                                      {doc.note && (
                                        <p className="text-[11px] text-[#627D98] italic">
                                          Note: {doc.note}
                                        </p>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1.5 shrink-0 pl-7 sm:pl-0">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewDoc(doc)}
                                      title="View Document in Preview Modal"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] hover:bg-[#F4F7FA] rounded-md transition-colors"
                                    >
                                      <Eye className="w-3.5 h-3.5 text-[#176B87]" />
                                      <span>View</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        downloadDocumentBlob(
                                          doc.id,
                                          doc.fileName
                                        )
                                      }
                                      title="Download File Locally"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#243B53] bg-white border border-[#D9E2EC] hover:bg-[#F4F7FA] rounded-md transition-colors"
                                    >
                                      <Download className="w-3.5 h-3.5 text-[#176B87]" />
                                      <span>Download</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setShareDocs([doc])}
                                      title="Share via WhatsApp"
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-white bg-[#16A34A] hover:bg-[#15803D] rounded-md transition-colors"
                                    >
                                      <Share2 className="w-3.5 h-3.5" />
                                      <span>Share via WhatsApp</span>
                                    </button>

                                    {isConfirmingDelete ? (
                                      <div className="inline-flex items-center gap-1 pl-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onDeleteDocument(doc);
                                            setConfirmDeleteDocId(null);
                                            setSelectedDocIds((prev) =>
                                              prev.filter((id) => id !== doc.id)
                                            );
                                          }}
                                          className="px-2.5 py-1.5 text-xs font-semibold text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-md"
                                        >
                                          Confirm Delete
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setConfirmDeleteDocId(null)
                                          }
                                          className="px-2 py-1.5 text-xs font-medium text-[#627D98] hover:text-[#102A43]"
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={currentUserRole !== 'Admin'}
                                        onClick={() =>
                                          setConfirmDeleteDocId(doc.id)
                                        }
                                        title={
                                          currentUserRole === 'Admin'
                                            ? 'Delete Document (Admin)'
                                            : 'Admin role required to delete documents'
                                        }
                                        className={`p-1.5 rounded-md border transition-colors ${
                                          currentUserRole === 'Admin'
                                            ? 'text-[#627D98] border-[#D9E2EC] hover:text-[#DC2626] hover:border-[#DC2626]/40 hover:bg-[#DC2626]/10'
                                            : 'text-[#D9E2EC] border-[#D9E2EC] cursor-not-allowed'
                                        }`}
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 2: Customer Cheque Ledger */}
                {activeTab === 'cheques' && (
                  <div className="overflow-x-auto">
                    {activeCustomer.cheques.length === 0 ? (
                      <div className="p-8 text-center text-xs text-[#627D98]">
                        No cheques logged for {activeCustomer.profile.partyName}{' '}
                        yet.
                      </div>
                    ) : (
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[#D9E2EC] bg-[#F4F7FA] text-[11px] font-semibold text-[#627D98]">
                            <th className="py-2.5 px-4">Cheque Date</th>
                            <th className="py-2.5 px-3">Cheque #</th>
                            <th className="py-2.5 px-3">Batch Ref</th>
                            <th className="py-2.5 px-3">Drawee Bank</th>
                            <th className="py-2.5 px-3 text-right">
                              Amount (₹)
                            </th>
                            <th className="py-2.5 px-3">Status</th>
                            <th className="py-2.5 px-4 text-right">
                              Documents
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#D9E2EC]">
                          {activeCustomer.cheques.map((chq) => {
                            const batch = batchMap.get(chq.batchId);
                            const linkedDocsCount =
                              activeCustomer.documents.filter(
                                (d) => d.linkedChequeId === chq.id
                              ).length;
                            return (
                              <tr key={chq.id} className="hover:bg-[#F4F7FA]/80">
                                <td className="py-2.5 px-4 font-mono-num text-[#243B53] whitespace-nowrap">
                                  {formatIndianDate(chq.chequeDate)}
                                </td>
                                <td className="py-2.5 px-3 font-mono-num font-semibold text-[#176B87]">
                                  #{chq.chequeNumber}
                                </td>
                                <td className="py-2.5 px-3 font-mono-num text-[#627D98]">
                                  {batch?.batchRef || '—'}
                                </td>
                                <td className="py-2.5 px-3 text-[#243B53]">
                                  {chq.draweeBank}
                                </td>
                                <td className="py-2.5 px-3 text-right font-mono-num font-semibold text-[#102A43]">
                                  {formatINR(chq.amount)}
                                </td>
                                <td className="py-2.5 px-3">
                                  <StatusTag status={chq.status} />
                                  {chq.bounceReason && (
                                    <div className="text-[10px] text-[#DC2626] mt-0.5">
                                      {chq.bounceReason}
                                    </div>
                                  )}
                                </td>
                                <td className="py-2.5 px-4 text-right">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDefaultLinkedChequeId(chq.id);
                                      setActiveTab('documents');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-[#176B87] bg-[#176B87]/10 border border-[#176B87]/25 hover:bg-[#176B87]/20 rounded transition-colors"
                                  >
                                    <Paperclip className="w-3 h-3" />
                                    <span>
                                      {linkedDocsCount > 0
                                        ? `${linkedDocsCount} Attached`
                                        : 'Attach Doc'}
                                    </span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}

                {/* TAB 3: Customer Activity & Audit History */}
                {activeTab === 'audit' && (
                  <div className="p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-[#102A43]">
                        Customer Document &amp; Cheque Audit Trail (
                        {customerAuditEntries.length})
                      </span>
                      <span className="text-[11px] text-[#627D98]">
                        Logs document uploads, Admin deletions, WhatsApp shares,
                        and cheque status transitions
                      </span>
                    </div>
                    <ActivityTimeline
                      entries={customerAuditEntries}
                      emptyMessage={`No audit events recorded yet for ${activeCustomer.profile.partyName}.`}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#102A43]/60 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-customer-modal-title"
        >
          <div className="bg-white border border-[#D9E2EC] rounded-lg shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-[#D9E2EC] bg-[#F4F7FA] flex items-center justify-between">
              <h3
                id="add-customer-modal-title"
                className="text-sm font-semibold text-[#102A43]"
              >
                Add New Customer Profile
              </h3>
              <button
                type="button"
                onClick={() => setShowAddCustomer(false)}
                className="p-1 text-[#627D98] hover:text-[#102A43]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreateCustomerSubmit} className="p-5 space-y-3.5 text-xs">
              <div>
                <label className="block font-medium text-[#243B53] mb-1">
                  Customer / Party Name *
                </label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="e.g. Reliance Infrastructure Ltd."
                  className="w-full px-3 py-2 border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#243B53] mb-1">
                    Customer Code
                  </label>
                  <input
                    type="text"
                    value={newCustCode}
                    onChange={(e) =>
                      setNewCustCode(e.target.value.toUpperCase())
                    }
                    placeholder="CUST-RI-001"
                    className="w-full px-3 py-2 font-mono-num uppercase border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#243B53] mb-1">
                    WhatsApp Mobile Number
                  </label>
                  <input
                    type="tel"
                    value={newCustMobile}
                    onChange={(e) => setNewCustMobile(e.target.value)}
                    placeholder="+91 98200 12345"
                    className="w-full px-3 py-2 font-mono-num border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-[#243B53] mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={newCustContact}
                    onChange={(e) => setNewCustContact(e.target.value)}
                    placeholder="Finance Manager"
                    className="w-full px-3 py-2 border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
                <div>
                  <label className="block font-medium text-[#243B53] mb-1">
                    Email
                  </label>
                  <input
                    type="email"
                    value={newCustEmail}
                    onChange={(e) => setNewCustEmail(e.target.value)}
                    placeholder="accounts@company.in"
                    className="w-full px-3 py-2 border border-[#D9E2EC] rounded-md text-[#243B53] focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/30 focus:border-[#176B87]"
                  />
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddCustomer(false)}
                  className="px-3.5 py-2 font-medium text-[#243B53] bg-white border border-[#D9E2EC] rounded-md hover:bg-[#F4F7FA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold text-[#102A43] bg-[#14B8A6] hover:bg-[#0D9488] rounded-md transition-colors"
                >
                  Create Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* In-App Preview Modal */}
      {previewDoc && (
        <DocumentPreviewModal
          documentItem={previewDoc}
          onClose={() => setPreviewDoc(null)}
          onShareWhatsApp={(doc) => {
            setPreviewDoc(null);
            setShareDocs([doc]);
          }}
        />
      )}

      {/* One-Click WhatsApp Share Modal */}
      {shareDocs && shareDocs.length > 0 && activeCustomer && (
        <WhatsAppShareModal
          companyId={company.id}
          companyName={company.profile.companyName}
          customer={activeCustomer.profile}
          documents={shareDocs}
          onClose={() => setShareDocs(null)}
          onSaveCustomerMobile={(newMobile) =>
            onSaveCustomerProfile({
              ...activeCustomer.profile,
              mobileNumber: newMobile,
              updatedAt: new Date().toISOString(),
            })
          }
          onRecordShare={({ documents, recipientPhone, channel }) => {
            onRecordDocumentShare({
              customerKey: activeCustomer.customerKey,
              customerName: activeCustomer.profile.partyName,
              documents,
              recipientPhone,
              channel,
            });
          }}
        />
      )}
    </div>
  );
}
