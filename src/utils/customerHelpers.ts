import {
  ChequeEntry,
  CompanyWorkspace,
  CustomerDocument,
  CustomerDocumentType,
  CustomerProfile,
  SystemAuditLogEntry,
} from '../types/treasury';

export const CUSTOMER_DOCUMENT_TYPES: CustomerDocumentType[] = [
  'Scanned Cheque Copy',
  'Return Memo',
  'KYC / ID Proof',
  'Agreement',
  'Signed Acknowledgement',
  'Other',
];

export const ACCEPTED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
]);

export function isAcceptedDocumentFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  if (ACCEPTED_DOCUMENT_MIME_TYPES.has(mime)) return true;
  return /\.(pdf|jpe?g|png)$/i.test(file.name);
}

export function inferDocumentMimeType(file: File): string {
  const mime = (file.type || '').toLowerCase();
  if (mime === 'application/pdf') return 'application/pdf';
  if (mime === 'image/png') return 'image/png';
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'image/jpeg';
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

export function getCustomerKey(
  customerCode?: string,
  partyName?: string
): string {
  const code = (customerCode || '').trim().toUpperCase();
  if (code) return `CODE::${code}`;
  const name = (partyName || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return `NAME::${name || 'unknown-customer'}`;
}

export interface CustomerSummaryItem {
  customerKey: string;
  profile: CustomerProfile;
  cheques: ChequeEntry[];
  documents: CustomerDocument[];
  totalAmount: number;
  returnedCount: number;
  returnedAmount: number;
  recoveredAmount: number;
  latestActivityDate: string;
}

export function buildCustomerDirectory(
  company: CompanyWorkspace
): CustomerSummaryItem[] {
  const map = new Map<string, CustomerSummaryItem>();

  // 1. Seed from saved customer profiles first
  for (const prof of company.customers || []) {
    const key = getCustomerKey(prof.customerCode, prof.partyName);
    map.set(key, {
      customerKey: key,
      profile: { ...prof },
      cheques: [],
      documents: [],
      totalAmount: 0,
      returnedCount: 0,
      returnedAmount: 0,
      recoveredAmount: 0,
      latestActivityDate: prof.updatedAt || '',
    });
  }

  // 2. Merge customers discovered from cheque entries
  for (const chq of company.cheques) {
    const key = getCustomerKey(chq.customerCode, chq.partyName);
    let item = map.get(key);
    if (!item) {
      item = {
        customerKey: key,
        profile: {
          id: `cust-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          customerCode: chq.customerCode || '—',
          partyName: chq.partyName,
          mobileNumber: '',
          updatedAt: chq.updatedAt || chq.createdAt,
        },
        cheques: [],
        documents: [],
        totalAmount: 0,
        returnedCount: 0,
        returnedAmount: 0,
        recoveredAmount: 0,
        latestActivityDate: chq.updatedAt || chq.chequeDate,
      };
      map.set(key, item);
    } else if (!item.profile.partyName && chq.partyName) {
      item.profile.partyName = chq.partyName;
    }

    item.cheques.push(chq);
    item.totalAmount += chq.amount;
    if (
      chq.status === 'Returned / Bounced' ||
      chq.status === 'Settled / Recovered' ||
      Boolean(chq.bouncedDate)
    ) {
      if (chq.status === 'Returned / Bounced') {
        item.returnedCount += 1;
        item.returnedAmount += chq.amount;
      }
      item.recoveredAmount += chq.recoveredAmount ?? 0;
    }
    const chqDate = chq.updatedAt || chq.chequeDate;
    if (chqDate > item.latestActivityDate) {
      item.latestActivityDate = chqDate;
    }
  }

  // 3. Attach stored documents to matching customer
  for (const doc of company.documents || []) {
    const key =
      doc.customerKey || getCustomerKey(doc.customerCode, doc.customerName);
    let item = map.get(key);
    if (!item) {
      item = {
        customerKey: key,
        profile: {
          id: `cust-${key.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          customerCode: doc.customerCode || '—',
          partyName: doc.customerName,
          mobileNumber: '',
          updatedAt: doc.uploadedAt,
        },
        cheques: [],
        documents: [],
        totalAmount: 0,
        returnedCount: 0,
        returnedAmount: 0,
        recoveredAmount: 0,
        latestActivityDate: doc.uploadedAt,
      };
      map.set(key, item);
    }
    item.documents.push(doc);
    if (doc.uploadedAt > item.latestActivityDate) {
      item.latestActivityDate = doc.uploadedAt;
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.documents.length !== a.documents.length) {
      return b.documents.length - a.documents.length;
    }
    if (b.returnedCount !== a.returnedCount) {
      return b.returnedCount - a.returnedCount;
    }
    return a.profile.partyName.localeCompare(b.profile.partyName);
  });
}

export function getCustomerAuditLogs(
  company: CompanyWorkspace,
  allCompanyLogs: SystemAuditLogEntry[],
  customerKey: string,
  customerName: string
): SystemAuditLogEntry[] {
  const customerChequeIds = new Set(
    company.cheques
      .filter(
        (c) => getCustomerKey(c.customerCode, c.partyName) === customerKey
      )
      .map((c) => c.id)
  );
  const customerDocIds = new Set(
    (company.documents || [])
      .filter(
        (d) =>
          (d.customerKey ||
            getCustomerKey(d.customerCode, d.customerName)) === customerKey
      )
      .map((d) => d.id)
  );
  const normalizedName = customerName.trim().toLowerCase();

  return allCompanyLogs
    .filter((entry) => {
      if (entry.companyId !== company.id) return false;
      if (entry.customerKey && entry.customerKey === customerKey) return true;
      if (entry.chequeId && customerChequeIds.has(entry.chequeId)) return true;
      if (entry.documentId && customerDocIds.has(entry.documentId)) return true;
      if (
        normalizedName &&
        entry.customerName &&
        entry.customerName.trim().toLowerCase() === normalizedName
      ) {
        return true;
      }
      if (
        normalizedName &&
        entry.description.toLowerCase().includes(normalizedName)
      ) {
        return true;
      }
      return false;
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function normalizeWhatsAppPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/[^\d]/g, '');
  if (!digits) return '';
  // Strip leading 00 or single 0 on local 10-digit Indian mobile numbers
  if (digits.length === 11 && digits.startsWith('0')) {
    return `91${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  if (digits.startsWith('00') && digits.length > 10) {
    return digits.slice(2);
  }
  return digits;
}

export function buildDocumentShareUrl(
  companyId: string,
  documentId: string,
  shareToken: string
): string {
  const origin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'https://clearledger.app';
  const params = new URLSearchParams({
    doc: documentId,
    company: companyId,
    token: shareToken,
  });
  return `${origin}/?${params.toString()}`;
}

export function buildWhatsAppShareMessage(params: {
  companyName: string;
  customerName: string;
  documents: CustomerDocument[];
  companyId: string;
}): string {
  const { companyName, customerName, documents, companyId } = params;
  if (documents.length === 0) return '';

  if (documents.length === 1) {
    const doc = documents[0];
    const link = buildDocumentShareUrl(companyId, doc.id, doc.shareToken);
    const chequeInfo = doc.linkedChequeNumber
      ? `\nLinked Cheque: #${doc.linkedChequeNumber}${doc.linkedBatchRef ? ` (Batch ${doc.linkedBatchRef})` : ''}`
      : '';
    return [
      `Dear ${customerName},`,
      ``,
      `Please find the requested document shared by *${companyName}*:`,
      `• Document Title: *${doc.title}*`,
      `• Category: ${doc.docType}${chequeInfo}`,
      ``,
      `Secure Document Link:`,
      link,
      ``,
      `Kindly review and confirm receipt.`,
      `Regards,`,
      `${companyName} — Treasury Desk`,
    ].join('\n');
  }

  const listLines = documents.map((doc, idx) => {
    const link = buildDocumentShareUrl(companyId, doc.id, doc.shareToken);
    const chqSuffix = doc.linkedChequeNumber
      ? ` [Cheque #${doc.linkedChequeNumber}]`
      : '';
    return `${idx + 1}. *${doc.title}* (${doc.docType})${chqSuffix}\n   ${link}`;
  });

  return [
    `Dear ${customerName},`,
    ``,
    `Please find *${documents.length} documents* shared by *${companyName}*:`,
    ``,
    ...listLines,
    ``,
    `Kindly review and confirm receipt.`,
    `Regards,`,
    `${companyName} — Treasury Desk`,
  ].join('\n');
}
