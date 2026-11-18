import * as XLSX from 'xlsx';
import { SystemAuditAction, SystemAuditLogEntry } from '../types/treasury';

export const AUDIT_ACTION_LABELS: Record<SystemAuditAction, string> = {
  BATCH_CREATED: 'Batch Created',
  BATCH_EDITED: 'Batch Edited',
  BATCH_LOCKED: 'Batch Locked',
  BATCH_UNLOCKED: 'Batch Unlocked (Bypass)',
  BATCH_STATUS_CHANGED: 'Batch Status Changed',
  CHEQUE_ADDED: 'Cheque Added',
  CHEQUE_EDITED: 'Cheque Edited',
  CHEQUE_DELETED: 'Cheque Deleted',
  CHEQUE_STATUS_CHANGED: 'Cheque Status Changed',
  BANK_STATEMENT_UPLOADED: 'Bank Statement Uploaded',
  RETURN_ACK_GENERATED: 'Return Acknowledgement Generated',
  RECOVERY_UPDATED: 'Recovery / Collection Updated',
  CHEQUE_REDEPOSITED: 'Cheque Re-Deposited',
  DOCUMENT_UPLOADED: 'Customer Document Uploaded',
  DOCUMENT_DELETED: 'Customer Document Deleted',
  DOCUMENT_SHARED: 'Document Shared via WhatsApp',
};

export const ALL_AUDIT_ACTIONS: SystemAuditAction[] = [
  'BATCH_CREATED',
  'BATCH_EDITED',
  'BATCH_LOCKED',
  'BATCH_UNLOCKED',
  'BATCH_STATUS_CHANGED',
  'CHEQUE_ADDED',
  'CHEQUE_EDITED',
  'CHEQUE_DELETED',
  'CHEQUE_STATUS_CHANGED',
  'BANK_STATEMENT_UPLOADED',
  'RETURN_ACK_GENERATED',
  'RECOVERY_UPDATED',
  'CHEQUE_REDEPOSITED',
  'DOCUMENT_UPLOADED',
  'DOCUMENT_DELETED',
  'DOCUMENT_SHARED',
];

export function formatAuditTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function exportAuditLogsToExcel(logs: SystemAuditLogEntry[]): string {
  const rows = logs.map((entry, idx) => ({
    'S.No': idx + 1,
    'Date & Time': formatAuditTimestamp(entry.timestamp),
    Company: entry.companyName,
    'Batch Ref': entry.batchRef || '—',
    'Cheque No': entry.chequeNumber || '—',
    'Action Type': AUDIT_ACTION_LABELS[entry.actionType] || entry.actionType,
    'Performed By': entry.actor,
    'Previous Value': entry.oldValue || '—',
    'New Value': entry.newValue || '—',
    Description: entry.description,
  }));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(
    rows.length > 0 ? rows : [{ Note: 'No audit log entries matched filters.' }]
  );
  ws['!cols'] = [
    { wch: 6 },
    { wch: 24 },
    { wch: 36 },
    { wch: 24 },
    { wch: 12 },
    { wch: 28 },
    { wch: 30 },
    { wch: 22 },
    { wch: 22 },
    { wch: 56 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'System Audit Log');

  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = `ClearLedger_Audit_Log_${dateTag}.xlsx`;
  XLSX.writeFile(wb, filename);
  return filename;
}
