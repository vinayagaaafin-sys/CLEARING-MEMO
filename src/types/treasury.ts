export type ClearingType =
  | 'Local CTS Clearing'
  | 'High-Value Clearing'
  | 'Outstation'
  | 'Same-Bank Transfer';

export type ChequeStatus =
  | 'Draft'
  | 'Submitted to Bank'
  | 'Cleared'
  | 'Returned / Bounced'
  | 'Settled / Recovered'
  | 'Re-Deposited';

export interface CompanyBankAccount {
  id: string;
  bankName: string;
  accountType: 'Cash Credit A/c' | 'Current A/c' | 'Collection A/c' | 'Overdraft A/c';
  accountNumber: string;
  ifscCode: string;
  branchName: string;
  branchAddress: string;
  isDefault?: boolean;
  openingBalance?: number;
  statementClosingBalance?: number;
  statementClosingDate?: string;
  lastReconciledFileName?: string;
  lastReconciledAt?: string;
}

export type DayBookVoucherType =
  | 'Receipt'
  | 'Payment'
  | 'Contra'
  | 'Bank Charges';

export type DayBookEntrySource =
  | 'CLEARED_CHEQUE'
  | 'RETURNED_CHEQUE'
  | 'RETURN_CHARGE'
  | 'BANK_STATEMENT'
  | 'MANUAL';

export interface DayBookEntry {
  id: string;
  companyBankAccountId: string; // Bank Account ID or 'CASH'
  txDate: string; // YYYY-MM-DD
  voucherType: DayBookVoucherType;
  direction: 'CR' | 'DR';
  amount: number;
  partyName: string; // Party / Account Head
  narration: string;
  refNo: string;
  source: DayBookEntrySource;
  linkedChequeId?: string;
  linkedChequeNumber?: string;
  statementFileName?: string;
  statementRunningBalance?: number;
  dedupeKey: string;
  createdAt: string;
  createdBy?: string;
}

export interface CorporateProfile {
  companyName: string;
  registeredAddress: string;
  pan: string;
  gstin: string;
  cin?: string;
  contactPhone: string;
  treasuryEmail: string;
  defaultMaker: string;
  defaultChecker: string;
  checkerPassword?: string;
  signatory1Name: string;
  signatory1Designation: string;
  signatory2Name: string;
  signatory2Designation: string;
  logoDataUrl?: string;
}

export interface BearerAuthorization {
  bearerName: string;
  bearerDesignation: string;
  idProofType: string;
  idProofNumber: string;
}

export type BatchStatus =
  | 'Draft'
  | 'Submitted to Bank'
  | 'Partially Realized'
  | 'Cleared'
  | 'Returned / Bounced';

export interface BatchAuditEntry {
  id: string;
  action: 'LOCKED' | 'UNLOCKED_BYPASS' | 'STATUS_UPDATED';
  actorRole: 'Maker' | 'Checker';
  actorName: string;
  timestamp: string;
  reason?: string;
}

export interface ClearingBatch {
  id: string;
  batchRef: string; // e.g., CLR/2026-27/NOV/0042
  depositDate: string; // YYYY-MM-DD
  companyBankAccountId: string;
  makerName: string;
  checkerName: string;
  status?: BatchStatus;
  isLocked: boolean;
  lockedAt?: string;
  lockedBy?: string;
  lockPassword?: string;
  auditTrail?: BatchAuditEntry[];
  notes?: string;
}

export type BankCollectionStatus = 'Pending Collection' | 'Collected from Bank';

export type RecoveryStatus =
  | 'Unrecovered'
  | 'Partially Recovered'
  | 'Recovered / Settled';

export interface RecoveryPaymentRecord {
  id: string;
  mode: 'NEFT / RTGS / UPI' | 'Cash' | 'Replacement Cheque' | 'Other';
  refNumber: string;
  paymentDate: string;
  amount: number;
  bounceChargesCollected?: number;
  remarks?: string;
  recordedAt: string;
}

export interface ChequeEntry {
  id: string;
  batchId: string;
  companyBankAccountId: string;
  chequeDate: string; // YYYY-MM-DD
  chequeNumber: string; // Strict 6 digits
  micrCode: string; // Strict 9 digits
  draweeBank: string;
  draweeBranch: string;
  clearingType: ClearingType;
  partyName: string;
  customerCode: string;
  invoiceRef: string;
  amount: number; // In INR up to hundreds of crores
  status: ChequeStatus;
  bounceReason?: string;
  penaltyAmount?: number;
  bounceChargesCollected?: number;
  bouncedDate?: string;
  returnUpdatedTimestamp?: string;
  lastAlertShownTime?: string;
  clearedDate?: string;
  bankCollectionStatus?: BankCollectionStatus;
  collectedFromBankDate?: string;
  collectedBy?: string;
  recoveryStatus?: RecoveryStatus;
  recoveredAmount?: number;
  recoveryDate?: string;
  recoveryMode?: string;
  recoveryRef?: string;
  recoveryPayments?: RecoveryPaymentRecord[];
  presentationCount?: number;
  reDepositedFromChequeId?: string;
  reDepositedToBatchId?: string;
  reDepositedToBatchRef?: string;
  reDepositedChequeId?: string;
  replacementChequeNumber?: string;
  replacementChequeDate?: string;
  replacementBankName?: string;
  replacementChequeId?: string;
  replacesChequeId?: string;
  replacesChequeNumber?: string;
  remarks?: string;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = 'Admin' | 'Maker';

export type CustomerDocumentType =
  | 'Scanned Cheque Copy'
  | 'Return Memo'
  | 'KYC / ID Proof'
  | 'Agreement'
  | 'Signed Acknowledgement'
  | 'Other';

export interface CustomerProfile {
  id: string;
  customerCode: string;
  partyName: string;
  mobileNumber: string;
  email?: string;
  contactPerson?: string;
  gstin?: string;
  pan?: string;
  address?: string;
  notes?: string;
  updatedAt: string;
}

export interface CustomerDocument {
  id: string;
  companyId: string;
  customerKey: string;
  customerCode: string;
  customerName: string;
  linkedChequeId?: string;
  linkedChequeNumber?: string;
  linkedBatchId?: string;
  linkedBatchRef?: string;
  title: string;
  docType: CustomerDocumentType;
  note?: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string;
  shareToken: string;
  shareCount?: number;
  lastSharedAt?: string;
  lastSharedTo?: string;
}

export interface BankHoliday {
  id: string;
  date: string; // YYYY-MM-DD
  name: string;
  category: 'National' | 'Tamil Nadu' | 'Custom';
  isDefault?: boolean;
}

export type ScheduledChequeStatus =
  | 'Scheduled'
  | 'In Clearing'
  | 'Cleared'
  | 'Returned / Bounced';

export type ScheduleFrequency =
  | 'Weekly'
  | 'Bi-Weekly'
  | 'Fortnightly'
  | 'Monthly'
  | 'Custom';

export type LoanInterestType =
  | 'FLAT_PA'
  | 'FLAT_PM'
  | 'REDUCING_EMI'
  | 'ZERO_INTEREST';

export interface ScheduledChequeItem {
  id: string;
  dueNumber?: number;
  chequeNumber: string;
  originalDate: string; // YYYY-MM-DD
  effectiveDate: string; // YYYY-MM-DD
  shiftReason?: string;
  principalAmount?: number;
  interestAmount?: number;
  amount: number;
  balance?: number;
  status: ScheduledChequeStatus;
  clearingBatchId?: string;
  clearingBatchRef?: string;
  clearingChequeId?: string;
  sentToClearingAt?: string;
}

export interface ScheduleScanDocument {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedAt: string;
  label?: string;
  thumbnailDataUrl?: string;
}

export interface CustomerChequeSchedule {
  id: string;
  customerName: string;
  customerCode?: string;
  loanRefNo: string;
  draweeBank: string;
  draweeBranch: string;
  micrCode?: string;
  companyBankAccountId?: string;
  holidayAutoShift: boolean;
  mode: 'auto' | 'manual';
  frequency?: ScheduleFrequency;
  customIntervalDays?: number;
  startDate?: string;
  startingChequeNumber?: string;
  principalAmount?: number;
  numberOfDues?: number;
  interestRate?: number;
  interestType?: LoanInterestType;
  roundDueToNearestRupee?: boolean;
  totalInterest?: number;
  totalPayable?: number;
  autoDueAmount?: number;
  cheques: ScheduledChequeItem[];
  scannedDocuments: ScheduleScanDocument[];
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyWorkspace {
  id: string;
  profile: CorporateProfile;
  bankAccounts: CompanyBankAccount[];
  batches: ClearingBatch[];
  cheques: ChequeEntry[];
  activeBatchId: string;
  customers?: CustomerProfile[];
  documents?: CustomerDocument[];
  letters?: Record<string, unknown>[];
  chequeSchedules?: CustomerChequeSchedule[];
  bankHolidays?: BankHoliday[];
  dayBookEntries?: DayBookEntry[];
}

export type SystemAuditAction =
  | 'BATCH_CREATED'
  | 'BATCH_EDITED'
  | 'BATCH_LOCKED'
  | 'BATCH_UNLOCKED'
  | 'BATCH_STATUS_CHANGED'
  | 'CHEQUE_ADDED'
  | 'CHEQUE_EDITED'
  | 'CHEQUE_DELETED'
  | 'CHEQUE_STATUS_CHANGED'
  | 'BANK_STATEMENT_UPLOADED'
  | 'RETURN_ACK_GENERATED'
  | 'RECOVERY_UPDATED'
  | 'CHEQUE_REDEPOSITED'
  | 'DOCUMENT_UPLOADED'
  | 'DOCUMENT_DELETED'
  | 'DOCUMENT_SHARED'
  | 'NOC_LETTER_GENERATED'
  | 'DD_CANCELLATION_GENERATED'
  | 'SCHEDULE_CREATED'
  | 'SCHEDULE_UPDATED'
  | 'SCHEDULE_DELETED'
  | 'SCHEDULED_CHEQUES_SENT_TO_CLEARING'
  | 'BANK_HOLIDAY_UPDATED'
  | 'DAY_BOOK_POSTED';

export interface SystemAuditLogEntry {
  id: string;
  timestamp: string;
  companyId: string;
  companyName: string;
  batchId?: string;
  batchRef?: string;
  chequeId?: string;
  chequeNumber?: string;
  customerKey?: string;
  customerName?: string;
  documentId?: string;
  documentTitle?: string;
  actionType: SystemAuditAction;
  actor: string;
  description: string;
  oldValue?: string;
  newValue?: string;
  metadata?: Record<string, string | number>;
}

export interface TreasuryState {
  companies: CompanyWorkspace[];
  activeCompanyId: string;
  auditLogs?: SystemAuditLogEntry[];
}

export type DateComplianceFlag = 'VALID' | 'PDC' | 'STALE';

export interface ChequeDateEvaluation {
  flag: DateComplianceFlag;
  daysDiffFromDeposit: number; // positive = chequeDate is older than depositDate; negative = PDC
  message: string;
}
