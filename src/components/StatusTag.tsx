import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileEdit,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { ChequeStatus, DateComplianceFlag } from '../types/treasury';

interface StatusTagProps {
  status: ChequeStatus;
}

export function StatusTag({ status }: StatusTagProps) {
  switch (status) {
    case 'Cleared':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#16A34A] whitespace-nowrap">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Cleared</span>
        </span>
      );
    case 'Settled / Recovered':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#16A34A] whitespace-nowrap">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Settled / Recovered</span>
        </span>
      );
    case 'Re-Deposited':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#176B87] whitespace-nowrap">
          <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Re-Deposited</span>
        </span>
      );
    case 'Submitted to Bank':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#2563EB] whitespace-nowrap">
          <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Submitted</span>
        </span>
      );
    case 'Returned / Bounced':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#DC2626] whitespace-nowrap">
          <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Bounced</span>
        </span>
      );
    case 'Draft':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#64748B] whitespace-nowrap">
          <FileEdit className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Draft</span>
        </span>
      );
  }
}

interface ComplianceIndicatorProps {
  flag: DateComplianceFlag;
  isHighValue?: boolean;
  isDuplicate?: boolean;
}

export function ComplianceIndicator({
  flag,
  isHighValue,
  isDuplicate,
}: ComplianceIndicatorProps) {
  if (flag === 'VALID' && !isHighValue && !isDuplicate) return null;

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-tight mt-0.5">
      {flag === 'PDC' && (
        <span className="inline-flex items-center gap-1 font-semibold text-[#B45309]">
          <AlertTriangle className="w-3 h-3 text-[#F59E0B] shrink-0" aria-hidden="true" />
          <span>PDC Hold</span>
        </span>
      )}
      {flag === 'STALE' && (
        <span className="inline-flex items-center gap-1 font-semibold text-[#DC2626]">
          <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Stale (&gt;90d)</span>
        </span>
      )}
      {isDuplicate && (
        <span className="inline-flex items-center gap-1 font-semibold text-[#DC2626]">
          <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>Duplicate Chq</span>
        </span>
      )}
      {isHighValue && (
        <span className="font-medium text-[#627D98]">High-Value (≥₹2L)</span>
      )}
    </div>
  );
}
