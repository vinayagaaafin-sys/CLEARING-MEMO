import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BOUNCE_REASONS } from '../data/indianBanks';
import { ChequeEntry, ClearingBatch } from '../types/treasury';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type StatementRowType = 'RETURN' | 'PASSED';

export interface ExtractedChequeCandidate {
  rawDigits: string;
  normalized: string; // digits with leading zeros stripped
  padded6: string; // left-padded to 6 digits if <= 6 digits (e.g. "17" -> "000017")
  last4: string; // 4-digit suffix of padded6 (e.g. "17" -> "0017")
  source: 'column' | 'explicit' | 'narration';
}

export interface UnmatchedChequeComparison {
  chequeNumber: string;
  last4: string;
  amount: number;
  chequeDate: string;
  status: string;
  mismatchReason: string;
}

export interface UnmatchedReturnDebugInfo {
  extractedCandidates: { raw: string; padded6: string; last4: string }[];
  transactionAmount: number;
  closestStoredCheques: UnmatchedChequeComparison[];
  manualReviewRequired?: boolean;
  ambiguousCheques?: ChequeEntry[];
}

export interface ParsedStatementRow {
  rowIndex: number;
  txnDate: string; // YYYY-MM-DD (empty if not present in row)
  hasValidDate: boolean;
  narration: string;
  chequeNumber: string; // Primary extracted cheque token for display
  extractedChequeNumbers: string[]; // All candidate tokens extracted from row
  chequeCandidates: ExtractedChequeCandidate[];
  debitAmount: number;
  creditAmount: number;
  amount: number;
  isCredit: boolean;
  hasReturnKeyword: boolean;
  rowType: StatementRowType;
  isReturnEntry: boolean;
  isChargeEntry: boolean;
  detectedReason: string;
  debugInfo?: UnmatchedReturnDebugInfo;
}

export interface ReconcileMatchCandidate {
  id: string; // unique row key
  matchType: 'RETURNED';
  matchMethod: 'EXACT' | 'LAST_4' | 'STMT_XREF' | 'AMOUNT_UNIQUE' | 'MANUAL';
  cheque: ChequeEntry;
  batchName: string;
  isBatchLocked: boolean;
  statementDate: string;
  statementNarration: string;
  statementAmount: number;
  isCredit: boolean;
  txnDirection?: 'CR' | 'DR';
  amountMatches: boolean;
  detectedReason: string;
  alreadyReturned: boolean;
  matchedStatementNumber: string;
  associatedChargeAmount?: number;
  duplicateRowsSkipped?: number;
  hasPassedAndReturnedPair?: boolean;
}

export interface ReconcileClearedCandidate {
  id: string;
  matchType: 'CLEARED';
  matchMethod: 'EXACT' | 'LAST_4' | 'AMOUNT_UNIQUE';
  cheque: ChequeEntry;
  batchName: string;
  isBatchLocked: boolean;
  statementDate: string;
  statementNarration: string;
  statementAmount: number;
  isCredit: boolean;
  txnDirection?: 'CR' | 'DR';
  amountMatches: boolean;
  alreadyCleared: boolean;
  matchedStatementNumber: string;
  duplicateRowsSkipped?: number;
}

export interface StatementParseResult {
  fileName: string;
  fileType: 'EXCEL' | 'CSV' | 'PDF';
  totalRowsParsed: number;
  returnRowsDetected: number;
  clearedRowsDetected: number;
  clearedMatches: ReconcileClearedCandidate[];
  returnedMatches: ReconcileMatchCandidate[];
  unmatchedReturnRows: ParsedStatementRow[];
  ignoredChargeRows: ParsedStatementRow[];
  ignoredDuplicateRows: ParsedStatementRow[];
}

const WHOLE_WORD_RETURN_REGEX =
  /\b(?:RTN|RET|RETN|RETURN|RETURNED|RETURNS|REJECT|REJECTED|BOUNCE|BOUNCED|UNPAID|DISHON|DISHONOR|DISHONORED|DISHONOUR|DISHONOURED|INSUFF|INSUFFICIENT|REFER\s+TO\s+DRAWER|STOP\s+PAYMENT|PAYMENT\s+STOPPED|STOPPED\s+BY\s+DRAWER|EXCEEDS\s+ARRANGEMENT|SIGNATURE\s+DIFFERS|SIGNATURE\s+MISMATCH|SIGN\s+DIFFERS|SIGN\s+MISMATCH|ACCOUNT\s+CLOSED|A\/C\s+CLOSED|STALE\s+CHEQUE|STALE\s+CHQ|NSF)\b/i;

const RETURN_KEYWORDS: RegExp[] = [
  WHOLE_WORD_RETURN_REGEX,
  /\b(?:CHQ|CHEQUE|CLG|CTS|OW|INW)(?:RET|RTN|RETN)\b/i,
  /\b(?:RET|RTN|RETN)(?:CHQ|CHEQUE|CLG)\b/i,
  /\b(?:CHQ|CHEQUE)[\s./\-:]*(?:RET|RETN|RTN|RETURN(?:ED)?|REJ(?:ECT(?:ED)?)?)\b/i,
  /\b(?:RET|RETN|RTN|RETURN(?:ED)?|REJ(?:ECT(?:ED)?)?)[\s./\-:]*(?:CHQ|CHEQUE)\b/i,
  /\b(?:INWARD|OUTWARD|CLG|CLEARING|ECS|CTS|I\/W|O\/W|BRN\/OW)[\s./\-:]*(?:CHQ[\s./\-:]*)?(?:RET|RETN|RTN|RETURN(?:ED)?)\b/i,
  /\bOW\s*RTN\b/i,
  /\bINW\s*RTN\b/i,
  /\bRTN\s*CLG\b/i,
  /\b(?:RET|RETN|RTN|RETURN)[\s./\-:]*MEMO\b/i,
  /\bFUNDS?\s+INSUFF(?:ICIENT)?\b/i,
  /\bINSUFF(?:ICIENT)?\.?\s+FUNDS?\b/i,
  /\bDRAWER\s+SIGN(?:ATURE)?\s*(?:DIFFERS|MISMATCH|IRREGULAR)\b/i,
];

const CLEARING_KEYWORDS: RegExp[] = [
  /\b(?:OW|OUTWARD|INW|INWARD|I\/W|O\/W|BY|TO|CTS|MICR|BRN\/OW|BRN\/IW)[\s./\-:]*CLG\b/i,
  /\bCLG\b/i,
  /\bCLEARING\b/i,
  /\bCTS\b/i,
  /\bMICR\b/i,
  /\bCHQ\s*PAID\b/i,
  /\bCHEQUE\s*PAID\b/i,
];

const PURE_DIGITAL_TRANSFER_KEYWORDS: RegExp[] = [
  /\b(?:UPI|IMPS|NEFT|RTGS|ATM|POS)\b/i,
];

const CHARGE_KEYWORDS: RegExp[] = [
  /\b(?:CHGS?|CHRGS?|CHARGES?)\b/i,
  /\b(?:FEES?|PENALT(?:Y|IES)|COMMISSION)\b/i,
  /\b(?:GST|CGST|SGST|IGST|TAX)\b/i,
  /\b(?:MEMO\s*CHG|RET(?:URN)?\s*CHG|RTN\s*CHG|BOUNCE\s*CHG|INCIDENTAL)\b/i,
];

const REASON_MATCHERS: { pattern: RegExp; reason: string }[] = [
  {
    pattern:
      /INSUFF(?:ICIENT)?\.?(?:\s*FUNDS?|\s*BAL(?:ANCE)?)?|FUNDS?\s*INSUFF(?:ICIENT)?\.?|NOT\s*SUFFICIENT|\bNSF\b/i,
    reason: BOUNCE_REASONS[0], // 01 - Funds Insufficient
  },
  {
    pattern: /EXCEEDS\s*ARRANGEMENT/i,
    reason: BOUNCE_REASONS[1], // 02 - Exceeds Arrangement
  },
  {
    pattern: /EFFECTS\s*NOT\s*CLEARED|PRESENT\s*AGAIN/i,
    reason: BOUNCE_REASONS[2], // 03 - Effects Not Cleared, Present Again
  },
  {
    pattern: /SIGN(?:ATURE)?\s*(?:MISMATCH|DIFFERS|DIFF|IRREGULAR)|DRAWER\s*SIGN/i,
    reason: BOUNCE_REASONS[3], // 10 - Drawer Signature Differs
  },
  {
    pattern: /ALTERATION|CORRECTION\s*REQUIRES/i,
    reason: BOUNCE_REASONS[4], // 11 - Alteration / Correction Requires Authentication
  },
  {
    pattern: /\bSTALE\b/i,
    reason: BOUNCE_REASONS[5], // 16 - Stale Cheque (Exceeds 90 Days)
  },
  {
    pattern: /POST\s*-?\s*DATED|\bPDC\b/i,
    reason: BOUNCE_REASONS[6], // 17 - Post-Dated Cheque (PDC)
  },
  {
    pattern: /ACCOUNT\s*CLOSED|A\/C\s*CLOSED/i,
    reason: BOUNCE_REASONS[7], // 20 - Account Closed
  },
  {
    pattern: /PAYMENT[\s./\-:]*STOP(?:PED)?|STOP[\s./\-:]*PAYMENT|STOPPED\s*BY\s*DRAWER/i,
    reason: BOUNCE_REASONS[8], // 21 - Payment Stopped by Drawer
  },
  {
    pattern: /UNDATED|INCOMPLETE/i,
    reason: BOUNCE_REASONS[9], // 31 - Instrument Undated / Incomplete
  },
  {
    pattern: /ENDORSEMENT/i,
    reason: BOUNCE_REASONS[10], // 41 - Payee Endorsement Irregular
  },
  {
    pattern: /REFER\s*TO\s*DRAWER/i,
    reason: 'Refer to Drawer',
  },
];

const GENERIC_RETURN_REASON = 'Cheque Returned (Verify Bank Return Memo)';

function stripNegatedReturnPhrases(text: string): string {
  return text
    .replace(/\b(?:NO|NOT|NON)\s*[\-/]?\s*RETURN(?:ED|S)?\b/gi, ' ')
    .replace(/\bUNRETURNED\b/gi, ' ');
}

export function hasWholeWordReturnKeyword(
  narration: string,
  statusHint = ''
): boolean {
  const cleanedHint = stripNegatedReturnPhrases(statusHint)
    .replace(/\b(?:CLEARED|PASSED|PAID|SUCCESS|SUCCESSFUL|STATUS|OW|INW|CLG|CLEARING|DR|CR|REV)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanedHint && WHOLE_WORD_RETURN_REGEX.test(cleanedHint)) {
    return true;
  }

  const sanitizedNarration = stripNegatedReturnPhrases(
    `${narration} ${cleanedHint}`.trim()
  );
  if (!sanitizedNarration) return false;

  return RETURN_KEYWORDS.some((rx) => rx.test(sanitizedNarration));
}

function isInwardReturnPhrase(narration: string): boolean {
  return /\b(?:INW|I\/W|INWARD)[\s./\-:]*(?:CHQ[\s./\-:]*)?(?:RET|RTN|RETN|RETURN(?:ED)?)\b/i.test(
    narration
  );
}

/**
 * Enforces whole-word Return keyword gate + DR/CR direction safety:
 * - If no whole-word return keyword -> NEVER RETURNED (always CLEARED).
 * - If row is a CREDIT (CR / Deposit) and not an explicit Inward return reversal -> ALWAYS CLEARED.
 * - Only classify as RETURNED when whole-word return keyword is present AND direction permits it.
 */
function classifyRowAsReturn(
  narration: string,
  statusHint: string,
  isCredit: boolean
): { hasReturnKeyword: boolean; isReturnEntry: boolean } {
  const hasReturnKeyword = hasWholeWordReturnKeyword(narration, statusHint);
  if (!hasReturnKeyword) {
    return { hasReturnKeyword: false, isReturnEntry: false };
  }
  if (isCredit && !isInwardReturnPhrase(narration)) {
    return { hasReturnKeyword, isReturnEntry: false };
  }
  return { hasReturnKeyword: true, isReturnEntry: true };
}

function hasClearingKeywords(narration: string): boolean {
  return CLEARING_KEYWORDS.some((rx) => rx.test(narration));
}

function isPureDigitalTransfer(narration: string): boolean {
  return (
    PURE_DIGITAL_TRANSFER_KEYWORDS.some((rx) => rx.test(narration)) &&
    !hasClearingKeywords(narration) &&
    !/\b(?:CHQ|CHEQUE|INST|INSTRUMENT)\b/i.test(narration)
  );
}

function hasChargeKeywords(narration: string): boolean {
  return CHARGE_KEYWORDS.some((rx) => rx.test(narration));
}

function detectReturnReason(narration: string, reasonHint = ''): string {
  const combined = `${reasonHint} ${narration}`.trim();
  for (const matcher of REASON_MATCHERS) {
    if (matcher.pattern.test(combined)) {
      return matcher.reason;
    }
  }
  if (reasonHint.trim()) {
    return reasonHint.trim();
  }
  const reasonAfterKeyword = narration.match(
    /(?:REASON|RSN|REMARK)\s*[:\-]\s*([A-Za-z0-9\s/,-]{4,60})/i
  );
  if (reasonAfterKeyword?.[1]) {
    return reasonAfterKeyword[1].trim();
  }
  return GENERIC_RETURN_REASON;
}

function parseIndianOrNumericAmount(raw: unknown): number {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.abs(raw) : 0;
  }
  if (typeof raw !== 'string') return 0;
  const cleaned = raw
    .replace(/[\u20B9$€£]/g, '')
    .replace(/\b(?:INR|RS\.?|CR|DR)\b/gi, '')
    .replace(/[,\s()]/g, '')
    .trim();
  if (!cleaned || cleaned === '-') return 0;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.abs(parsed) : 0;
}

const MONTH_MAP: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function parseStatementDate(raw: unknown): { txnDate: string; hasValidDate: boolean } {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return { txnDate: raw.toISOString().slice(0, 10), hasValidDate: true };
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + raw * 86400000);
    if (!Number.isNaN(dt.getTime())) {
      return { txnDate: dt.toISOString().slice(0, 10), hasValidDate: true };
    }
  }
  const str = String(raw ?? '').trim();
  if (!str) return { txnDate: '', hasValidDate: false };

  const isoMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (isoMatch) {
    return {
      txnDate: `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`,
      hasValidDate: true,
    };
  }

  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (dmyMatch) {
    const year = dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return {
      txnDate: `${year}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`,
      hasValidDate: true,
    };
  }

  const dMonYMatch = str.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[-\s/](\d{2,4})/);
  if (dMonYMatch) {
    const mon = MONTH_MAP[dMonYMatch[2].toLowerCase()];
    if (mon) {
      const year =
        dMonYMatch[3].length === 2 ? `20${dMonYMatch[3]}` : dMonYMatch[3];
      return {
        txnDate: `${year}-${mon}-${dMonYMatch[1].padStart(2, '0')}`,
        hasValidDate: true,
      };
    }
  }

  return { txnDate: '', hasValidDate: false };
}

/**
 * Strips all non-numeric characters, spaces, and leading zeros (e.g., "004521" -> "4521").
 */
export function normalizeChequeNumber(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.replace(/^0+/, '');
}

/**
 * Left-pads a cheque number with zeros to 6 digits when <= 6 digits (e.g. "17" -> "000017").
 */
export function padCheque6(raw: unknown): string {
  const normalized = normalizeChequeNumber(raw);
  if (!normalized) return '';
  return normalized.length <= 6 ? normalized.padStart(6, '0') : normalized;
}

/**
 * Generates last 4 digits from the 6-digit zero-padded form (e.g. "17" -> "0017").
 */
export function getLast4Digits(raw: unknown): string {
  const padded = padCheque6(raw);
  if (!padded) return '';
  return padded.slice(-4);
}

/**
 * Strips formatted currency amounts and running balances (e.g. "68,61,489.60",
 * "2,00,000.00", "25000.00") BEFORE extracting candidate cheque numbers.
 */
export function stripCurrencyAndBalances(text: string): string {
  return String(text ?? '')
    .replace(/(?<!\d)\d{1,3}(?:,\d{2,3})+\.\d{1,2}(?!\d)/g, ' ')
    .replace(/(?<!\d)\d{1,3}(?:,\d{2,3})+(?!\d)/g, ' ')
    .replace(/(?<!\d)\d+\.\d{1,2}(?!\d|\.\d)/g, ' ');
}

function buildCandidate(
  rawDigits: string,
  source: ExtractedChequeCandidate['source'],
  minDigits = 3
): ExtractedChequeCandidate | null {
  const cleaned = rawDigits.replace(/\D/g, '');
  if (cleaned.length < minDigits) return null;
  const normalized = cleaned.replace(/^0+/, '');
  if (!normalized) return null;
  const padded6 = normalized.length <= 6 ? normalized.padStart(6, '0') : normalized;
  const last4 = padded6.slice(-4);
  return {
    rawDigits: cleaned,
    normalized,
    padded6,
    last4,
    source,
  };
}

/**
 * Multi-candidate extraction:
 * 1. Strips all currency amounts & running balances from narration text first.
 * 2. Explicitly extracts 1-to-8 digit cheque numbers after keywords like REJECT:, CHQ, CHEQUE, INST, NO.
 * 3. Extracts all standalone/delimiter-separated numeric tokens (3+ digits) across Cheque/Ref No + Narration.
 */
export function extractChequeCandidates(
  rawChqCol: unknown,
  narration: string
): ExtractedChequeCandidate[] {
  const candidates: ExtractedChequeCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (cand: ExtractedChequeCandidate | null) => {
    if (!cand) return;
    const key = `${cand.padded6}|${cand.source}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(cand);
  };

  // 1. Dedicated Cheque/Ref No column (allows 1+ digits, handles spaces like "00 4521")
  const colStr = String(rawChqCol ?? '').trim();
  if (colStr) {
    const colDigitsOnly = colStr.replace(/\D/g, '');
    if (colDigitsOnly.length >= 1) {
      pushCandidate(buildCandidate(colDigitsOnly, 'column', 1));
    }
    const colParts = colStr.split(/[\s/\-:.,;#()]+/);
    for (const part of colParts) {
      const digitMatches = part.match(/\d+/g) || [];
      for (const token of digitMatches) {
        pushCandidate(buildCandidate(token, 'column', 1));
      }
    }
  }

  // 2. Strip currency amounts & running balances BEFORE scanning narration
  const sanitizedNarration = stripCurrencyAndBalances(narration);

  // 3. Explicit 1-to-8 digit extraction after REJECT:, CHQ, CHEQUE, INST, NO., or CLG/<digits>
  const explicitRegex =
    /(?:REJECT(?:ED)?|REJ|CHQ(?:\s*(?:NO|NUM|NUMBER))?|CHEQUE(?:\s*(?:NO|NUM|NUMBER))?|INST(?:RUMENT)?(?:\s*(?:NO|NUM|NUMBER))?|NO\.?)\s*[:#\-/\s.]*(\d{1,8})(?!\d)/gi;
  for (const match of sanitizedNarration.matchAll(explicitRegex)) {
    if (match[1]) {
      pushCandidate(buildCandidate(match[1], 'explicit', 1));
    }
  }
  const clgSlashExplicitRegex = /\bCLG\/(\d{1,8})\b/gi;
  for (const match of sanitizedNarration.matchAll(clgSlashExplicitRegex)) {
    if (match[1]) {
      pushCandidate(buildCandidate(match[1], 'explicit', 1));
    }
  }
  const clgDelimExplicitRegex = /\bCLG(?:\s*NO\.?)?\s*[:#\-]\s*(\d{1,8})(?![\d/\-])/gi;
  for (const match of sanitizedNarration.matchAll(clgDelimExplicitRegex)) {
    if (match[1]) {
      pushCandidate(buildCandidate(match[1], 'explicit', 1));
    }
  }

  // 4. Scan remaining sanitized narration by splitting on delimiters and extracting numeric tokens (3+ digits)
  const narrationParts = sanitizedNarration.split(/[\s/\-:.,;#()]+/);
  for (const part of narrationParts) {
    if (!part) continue;
    const digitMatches = part.match(/\d+/g) || [];
    for (const token of digitMatches) {
      pushCandidate(buildCandidate(token, 'narration', 3));
    }
  }

  // Deduplicate keeping highest-priority source per padded6
  const uniqueByPadded = new Map<string, ExtractedChequeCandidate>();
  for (const cand of candidates) {
    if (!uniqueByPadded.has(cand.padded6)) {
      uniqueByPadded.set(cand.padded6, cand);
    }
  }
  return Array.from(uniqueByPadded.values());
}

function normalizeHeaderKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findColumnKey(headers: string[], candidates: string[]): string | undefined {
  const normalizedMap = new Map(headers.map((h) => [normalizeHeaderKey(h), h]));
  for (const cand of candidates) {
    const exact = normalizedMap.get(cand);
    if (exact) return exact;
  }
  for (const [norm, orig] of normalizedMap.entries()) {
    if (candidates.some((cand) => cand.length >= 4 && norm.includes(cand))) {
      return orig;
    }
  }
  return undefined;
}

const BOILERPLATE_PDF_LINE =
  /^(?:page\s+\d+(?:\s+of\s+\d+)?|statement\s+of\s+account|opening\s+balance|closing\s+balance|brought\s+forward|carried\s+forward|txn\s*date\s+particulars|date\s+narration|generated\s+on)/i;

const CONTINUATION_HINT =
  /(?:REJECT|REJ:|FUNDS?\s*INSUFF|INSUFF|SIGN(?:ATURE)?|REFER\s*TO\s*DRAWER|PAYMENT\s*STOP|ACCOUNT\s*CLOSED|STALE|\[TN\]|\[[A-Z]{2}\])/i;

function isWrappedContinuationRow(row: ParsedStatementRow, rawLine?: string): boolean {
  if (row.amount > 0 || row.debitAmount > 0 || row.creditAmount > 0) return false;
  const trimmed = row.narration.trim();
  if (!trimmed || BOILERPLATE_PDF_LINE.test(trimmed)) return false;

  // A zero-amount REJECT:/reason continuation line can wrap even if a date token appeared in it
  if (CONTINUATION_HINT.test(trimmed)) return true;

  if (row.hasValidDate) return false;

  const lineToCheck = (rawLine ?? trimmed).trim();
  const startsWithDate =
    /^(?:\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-\s/][A-Za-z]{3}[-\s/]\d{2,4})\b/.test(
      lineToCheck
    );
  return !startsWithDate;
}

function canMergeWrappedContinuation(
  prev: ParsedStatementRow,
  contRow: ParsedStatementRow
): boolean {
  if (prev.hasValidDate && contRow.hasValidDate && prev.txnDate !== contRow.txnDate) {
    return false;
  }

  const contHasReturnOrReject =
    hasWholeWordReturnKeyword(contRow.narration) ||
    CONTINUATION_HINT.test(contRow.narration);

  // CRITICAL: Never merge a REJECT: / RTN wrapped continuation line into:
  // 1) a Credit (CR) row, or
  // 2) a normal PASSED row that does NOT already have DR / return-clearing indicators.
  if (contHasReturnOrReject) {
    if (prev.isCredit) {
      return false;
    }
    const prevHasReturnClearingIndicator =
      prev.isReturnEntry ||
      hasWholeWordReturnKeyword(prev.narration) ||
      /\b(?:OW[\s./\-:]*RTN|INW[\s./\-:]*RTN|CHQ[\s./\-:]*(?:RET|RTN)|RTN[\s./\-:]*CLG)\b/i.test(
        prev.narration
      );
    if (!prevHasReturnClearingIndicator) {
      return false;
    }
  }

  // Never merge if the continuation row carries an explicit cheque number that differs
  // from an explicit cheque number already on the previous row.
  const prevExplicit = prev.chequeCandidates
    .filter((c) => c.source === 'column' || c.source === 'explicit')
    .map((c) => c.padded6);
  const contExplicit = contRow.chequeCandidates
    .filter((c) => c.source === 'column' || c.source === 'explicit')
    .map((c) => c.padded6);

  if (
    prevExplicit.length > 0 &&
    contExplicit.length > 0 &&
    !contExplicit.some((c) => prevExplicit.includes(c))
  ) {
    return false;
  }

  return true;
}

function mergeWrappedRows(rows: ParsedStatementRow[]): ParsedStatementRow[] {
  const merged: ParsedStatementRow[] = [];

  for (const row of rows) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      isWrappedContinuationRow(row) &&
      canMergeWrappedContinuation(prev, row)
    ) {
      const combinedNarration = `${prev.narration} ${row.narration}`
        .replace(/\s+/g, ' ')
        .trim();
      const classification = classifyRowAsReturn(
        combinedNarration,
        '',
        prev.isCredit
      );
      const isReturnEntry = prev.isReturnEntry || classification.isReturnEntry;
      const chequeCandidates = extractChequeCandidates('', combinedNarration);
      const extractedChequeNumbers = chequeCandidates.map((c) => c.rawDigits);
      const chequeNumber =
        chequeCandidates[0]?.rawDigits || chequeCandidates[0]?.normalized || '';

      merged[merged.length - 1] = {
        ...prev,
        narration: combinedNarration,
        hasReturnKeyword: prev.hasReturnKeyword || classification.hasReturnKeyword,
        isReturnEntry,
        rowType: isReturnEntry ? 'RETURN' : 'PASSED',
        isChargeEntry: isReturnEntry && hasChargeKeywords(combinedNarration),
        detectedReason: isReturnEntry ? detectReturnReason(combinedNarration) : '',
        chequeCandidates,
        extractedChequeNumbers,
        chequeNumber,
      };
      continue;
    }

    merged.push(row);
  }

  return merged;
}

function parseTabularMatrix(matrix: unknown[][]): ParsedStatementRow[] {
  if (matrix.length === 0) return [];

  let headerIdx = 0;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const rowText = (matrix[i] || [])
      .map((cell) => String(cell ?? '').toLowerCase())
      .join(' ');
    if (
      (rowText.includes('date') || rowText.includes('txn')) &&
      (rowText.includes('narration') ||
        rowText.includes('description') ||
        rowText.includes('particular') ||
        rowText.includes('remark') ||
        rowText.includes('debit') ||
        rowText.includes('credit') ||
        rowText.includes('amount'))
    ) {
      headerIdx = i;
      break;
    }
  }

  const rawHeaders = (matrix[headerIdx] || []).map((cell, idx) => {
    const s = String(cell ?? '').trim();
    return s || `col_${idx}`;
  });

  const dateKey = findColumnKey(rawHeaders, [
    'txndate',
    'transactiondate',
    'valuedate',
    'trandate',
    'postingdate',
    'date',
  ]);
  const narrationKey = findColumnKey(rawHeaders, [
    'narration',
    'description',
    'transdesc',
    'particulars',
    'transactiondetails',
    'txndetails',
    'details',
    'remarks',
    'memo',
  ]);
  const chequeKey = findColumnKey(rawHeaders, [
    'chequeno',
    'chequenumber',
    'chequerefno',
    'chqno',
    'chqrefno',
    'chqref',
    'instrumentno',
    'instno',
    'refno',
    'cheque',
  ]);
  const debitKey = findColumnKey(rawHeaders, [
    'debit',
    'withdrawal',
    'withdrawalamt',
    'debitamount',
    'dr',
  ]);
  const creditKey = findColumnKey(rawHeaders, [
    'credit',
    'deposit',
    'depositamt',
    'creditamount',
    'cr',
  ]);
  const amountKey = findColumnKey(rawHeaders, [
    'amount',
    'txnamount',
    'transactionamount',
    'chqamount',
  ]);
  const typeKey =
    findColumnKey(rawHeaders, [
      'drcr',
      'crdr',
      'txntype',
      'transactiontype',
      'indicator',
    ]) || rawHeaders.find((h) => normalizeHeaderKey(h) === 'type');
  const statusKey = findColumnKey(rawHeaders, ['status', 'txnstatus', 'returnstatus']);
  const reasonKey = findColumnKey(rawHeaders, [
    'reason',
    'returnreason',
    'bouncereason',
    'reasonofreturn',
  ]);

  const parsedRows: ParsedStatementRow[] = [];

  for (let r = headerIdx + 1; r < matrix.length; r++) {
    const rawRow = matrix[r];
    if (
      !rawRow ||
      rawRow.every((c) => c === null || c === undefined || String(c).trim() === '')
    ) {
      continue;
    }

    const rowObj: Record<string, unknown> = {};
    rawHeaders.forEach((h, idx) => {
      rowObj[h] = rawRow[idx];
    });

    const fallbackText = rawRow
      .map((c) => String(c ?? '').trim())
      .filter(Boolean)
      .join(' ');

    const narration = narrationKey
      ? String(rowObj[narrationKey] ?? '').trim()
      : fallbackText;
    const statusHint = statusKey ? String(rowObj[statusKey] ?? '').trim() : '';
    const reasonHint = reasonKey ? String(rowObj[reasonKey] ?? '').trim() : '';

    let debitAmount = debitKey ? parseIndianOrNumericAmount(rowObj[debitKey]) : 0;
    let creditAmount = creditKey ? parseIndianOrNumericAmount(rowObj[creditKey]) : 0;
    const genericAmount = amountKey ? parseIndianOrNumericAmount(rowObj[amountKey]) : 0;
    const amount = debitAmount || creditAmount || genericAmount;

    if (debitAmount === 0 && creditAmount === 0 && genericAmount > 0) {
      const rawAmtText = amountKey ? String(rowObj[amountKey] ?? '') : '';
      const typeVal = typeKey
        ? String(rowObj[typeKey] ?? '').trim().toUpperCase()
        : '';

      if (
        typeVal === 'CR' ||
        typeVal === 'CREDIT' ||
        typeVal === 'C' ||
        /\bCR\b/i.test(rawAmtText)
      ) {
        creditAmount = genericAmount;
      } else if (
        typeVal === 'DR' ||
        typeVal === 'DEBIT' ||
        typeVal === 'D' ||
        /\bDR\b/i.test(rawAmtText)
      ) {
        debitAmount = genericAmount;
      } else if (/\bCR\b/i.test(statusHint) && !/\bDR\b/i.test(statusHint)) {
        creditAmount = genericAmount;
      } else if (/\bDR\b/i.test(statusHint) && !/\bCR\b/i.test(statusHint)) {
        debitAmount = genericAmount;
      }
    }

    const effectiveNarration = narration || fallbackText;
    const isCredit =
      (creditAmount > 0 && debitAmount === 0) ||
      (creditAmount === 0 &&
        debitAmount === 0 &&
        /\bCR\b/i.test(effectiveNarration) &&
        !/\bDR\b/i.test(effectiveNarration));
    const { hasReturnKeyword, isReturnEntry } = classifyRowAsReturn(
      effectiveNarration,
      `${statusHint} ${reasonHint}`,
      isCredit
    );
    const rowType: StatementRowType = isReturnEntry ? 'RETURN' : 'PASSED';

    const searchNarration = narrationKey
      ? [narration, statusHint, reasonHint].filter(Boolean).join(' ')
      : fallbackText;

    const chequeCandidates = extractChequeCandidates(
      chequeKey ? rowObj[chequeKey] : '',
      searchNarration
    );
    const extractedChequeNumbers = chequeCandidates.map((c) => c.rawDigits);
    const chequeNumber =
      chequeCandidates[0]?.rawDigits || chequeCandidates[0]?.normalized || '';

    const parsedDate = dateKey
      ? parseStatementDate(rowObj[dateKey])
      : parseStatementDate(
          fallbackText.match(/\d{1,4}[-/.][A-Za-z0-9]{2,3}[-/.]\d{2,4}/)?.[0]
        );

    const isChargeEntry = isReturnEntry && hasChargeKeywords(effectiveNarration);

    parsedRows.push({
      rowIndex: r + 1,
      txnDate: parsedDate.txnDate,
      hasValidDate: parsedDate.hasValidDate,
      narration: effectiveNarration,
      chequeNumber,
      extractedChequeNumbers,
      chequeCandidates,
      debitAmount,
      creditAmount,
      amount,
      isCredit,
      hasReturnKeyword,
      rowType,
      isReturnEntry,
      isChargeEntry,
      detectedReason: isReturnEntry ? detectReturnReason(narration, reasonHint) : '',
    });
  }

  return mergeWrappedRows(parsedRows);
}

async function parsePdfToLines(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdfDoc = await loadingTask.promise;
  const allLines: string[] = [];

  for (let p = 1; p <= pdfDoc.numPages; p++) {
    const page = await pdfDoc.getPage(p);
    const content = await page.getTextContent();
    const rowBuckets = new Map<number, { x: number; str: string }[]>();

    for (const item of content.items) {
      if (!('str' in item)) continue;
      const textItem = item as { str: string; transform: number[] };
      const str = textItem.str.trim();
      if (!str) continue;
      const x = textItem.transform[4] ?? 0;
      const y = Math.round((textItem.transform[5] ?? 0) / 3) * 3;
      const bucket = rowBuckets.get(y) || [];
      bucket.push({ x, str });
      rowBuckets.set(y, bucket);
    }

    const sortedY = Array.from(rowBuckets.keys()).sort((a, b) => b - a);
    for (const y of sortedY) {
      const items = (rowBuckets.get(y) || []).sort((a, b) => a.x - b.x);
      const line = items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      if (line) allLines.push(line);
    }
  }

  return allLines;
}

function parsePdfLines(lines: string[]): ParsedStatementRow[] {
  const rows: ParsedStatementRow[] = [];

  lines.forEach((line, idx) => {
    const dateMatch = line.match(
      /\b(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{1,2}[-\s/][A-Za-z]{3}[-\s/]\d{2,4})\b/
    );
    const parsedDate = parseStatementDate(dateMatch?.[1]);

    const tokenMatches = Array.from(
      line.matchAll(
        /(?<!\d)(\d{1,3}(?:,\d{2,3})*\.\d{1,2}|\d+\.\d{1,2})(?:\s*\(?(DR|CR)\)?\.?)?(?!\d)/gi
      )
    ).map((m) => ({
      amount: parseIndianOrNumericAmount(m[1]),
      tag: (m[2] || '').toUpperCase(),
      startIndex: m.index ?? 0,
    }));

    // Ignore leading 0.00 placeholders when a Debit/Credit column is 0.00 and another positive token exists
    const positiveTokens = tokenMatches.filter((t) => t.amount > 0);
    const txnToken =
      positiveTokens.length > 0
        ? positiveTokens[0]
        : tokenMatches[0] || { amount: 0, tag: '', startIndex: line.length };

    const amount = txnToken.amount;
    // Slice before running balance token so running balance's "CR" doesn't mask a "DR" transaction
    const nextPositiveToken = positiveTokens.length >= 2 ? positiveTokens[1] : null;
    const txnSlice = nextPositiveToken
      ? line.slice(0, nextPositiveToken.startIndex)
      : line;
    const hasExplicitCr =
      txnToken.tag === 'CR' ||
      (/\bCR\b/i.test(txnSlice) && !/\bDR\b/i.test(txnSlice));
    const hasExplicitDr =
      txnToken.tag === 'DR' ||
      (/\bDR\b/i.test(txnSlice) && !/\bCR\b/i.test(txnSlice));

    const isCredit =
      hasExplicitCr ||
      (!hasExplicitDr &&
        /\b(?:BY[\s./\-:]*CLG|OW[\s./\-:]*CLG|CLG\/)\b/i.test(line) &&
        !hasWholeWordReturnKeyword(line));
    const debitAmount = !isCredit && hasExplicitDr ? amount : 0;
    const creditAmount = isCredit ? amount : 0;

    const { hasReturnKeyword, isReturnEntry } = classifyRowAsReturn(
      line,
      '',
      isCredit
    );
    const rowType: StatementRowType = isReturnEntry ? 'RETURN' : 'PASSED';

    const chequeCandidates = extractChequeCandidates('', line);
    const extractedChequeNumbers = chequeCandidates.map((c) => c.rawDigits);
    const chequeNumber =
      chequeCandidates[0]?.rawDigits || chequeCandidates[0]?.normalized || '';

    // Directly append zero-amount REJECT:<digits> lines onto the immediately preceding non-CR transaction row
    if (
      amount === 0 &&
      debitAmount === 0 &&
      creditAmount === 0 &&
      /\bREJECT\s*[:\-]/i.test(line) &&
      rows.length > 0
    ) {
      let targetIdx = rows.length - 1;
      while (targetIdx > 0 && rows[targetIdx].amount === 0) {
        targetIdx -= 1;
      }
      const prev = rows[targetIdx];
      if (
        prev &&
        (!prev.isCredit || prev.isReturnEntry || /\b(?:RTN|RET|RETURN)\b/i.test(prev.narration))
      ) {
        const trailingLines = rows
          .slice(targetIdx + 1)
          .map((r) => r.narration)
          .join(' ');
        const combinedNarration = `${prev.narration} ${trailingLines} ${line}`
          .replace(/\s+/g, ' ')
          .trim();
        const mergedClassification = classifyRowAsReturn(
          combinedNarration,
          '',
          prev.isCredit
        );
        const mergedIsReturn = prev.isReturnEntry || mergedClassification.isReturnEntry;
        const mergedCandidates = extractChequeCandidates('', combinedNarration);
        rows[targetIdx] = {
          ...prev,
          narration: combinedNarration,
          hasReturnKeyword: prev.hasReturnKeyword || mergedClassification.hasReturnKeyword,
          isReturnEntry: mergedIsReturn,
          rowType: mergedIsReturn ? 'RETURN' : 'PASSED',
          isChargeEntry: mergedIsReturn && hasChargeKeywords(combinedNarration),
          detectedReason: mergedIsReturn ? detectReturnReason(combinedNarration) : '',
          chequeCandidates: mergedCandidates,
          extractedChequeNumbers: mergedCandidates.map((c) => c.rawDigits),
          chequeNumber:
            mergedCandidates[0]?.rawDigits || mergedCandidates[0]?.normalized || '',
        };
        if (targetIdx < rows.length - 1) {
          rows.splice(targetIdx + 1);
        }
        return;
      }
    }

    rows.push({
      rowIndex: idx + 1,
      txnDate: parsedDate.txnDate,
      hasValidDate: parsedDate.hasValidDate,
      narration: line,
      chequeNumber,
      extractedChequeNumbers,
      chequeCandidates,
      debitAmount,
      creditAmount,
      amount,
      isCredit,
      hasReturnKeyword,
      rowType,
      isReturnEntry,
      isChargeEntry: isReturnEntry && hasChargeKeywords(line),
      detectedReason: isReturnEntry ? detectReturnReason(line) : '',
    });
  });

  return mergeWrappedRows(rows);
}

function getDateProximityDays(dateA: string, dateB: string): number {
  if (!dateA || !dateB) return Number.MAX_SAFE_INTEGER;
  const tA = Date.parse(dateA);
  const tB = Date.parse(dateB);
  if (Number.isNaN(tA) || Number.isNaN(tB)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(Math.round((tA - tB) / 86400000));
}

function isPendingOrDepositedCheque(cheque: ChequeEntry): boolean {
  return (
    cheque.status === 'Draft' ||
    cheque.status === 'Submitted to Bank' ||
    cheque.status === 'Re-Deposited'
  );
}

interface CandidatePair {
  cheque: ChequeEntry;
  candidate: ExtractedChequeCandidate;
  isExact6Match: boolean;
}

interface ResolvedRow {
  row: ParsedStatementRow;
  matchType: ReconcileMatchCandidate['matchMethod'] | 'NONE';
  matchedCheque: ChequeEntry | null;
  matchedCandidate: ExtractedChequeCandidate | null;
  isChargeLike: boolean;
  ambiguousCheques?: ChequeEntry[];
}

function pickBestPair(pairs: CandidatePair[], row: ParsedStatementRow): CandidatePair {
  return [...pairs].sort((a, b) => {
    // 1. Prefer exact 6-digit zero-padded match (e.g. "000017" == "000017")
    if (a.isExact6Match !== b.isExact6Match) {
      return a.isExact6Match ? -1 : 1;
    }
    // 2. Prefer explicit keyword / dedicated column candidate over generic narration tokens
    const sourceRank = (s: ExtractedChequeCandidate['source']) =>
      s === 'column' ? 0 : s === 'explicit' ? 1 : 2;
    const rankDiff = sourceRank(a.candidate.source) - sourceRank(b.candidate.source);
    if (rankDiff !== 0) return rankDiff;

    // 3. Date proximity tie-breaker when 2+ cheques share same last 4 digits AND exact same amount
    if (row.hasValidDate) {
      const diffA = getDateProximityDays(row.txnDate, a.cheque.chequeDate);
      const diffB = getDateProximityDays(row.txnDate, b.cheque.chequeDate);
      if (diffA !== diffB) return diffA - diffB;
    }
    // 4. For PASSED rows, prefer Pending/In-Clearing cheques; for RETURN rows, prefer active/cleared
    const scoreStatus = (s: ChequeEntry['status']) =>
      row.rowType === 'PASSED'
        ? s === 'Submitted to Bank' || s === 'Draft' || s === 'Re-Deposited'
          ? 2
          : s === 'Cleared'
          ? 1
          : 0
        : s === 'Submitted to Bank' || s === 'Cleared' || s === 'Draft'
        ? 1
        : 0;
    const statusDiff = scoreStatus(b.cheque.status) - scoreStatus(a.cheque.status);
    if (statusDiff !== 0) return statusDiff;

    return (b.cheque.chequeDate || '').localeCompare(a.cheque.chequeDate || '');
  })[0];
}

/**
 * Database-first candidate matching for BOTH Return rows and non-Return (Cleared/Passed) rows:
 * Compares EVERY extracted candidate (6-digit left-padded and last-4) against stored cheques
 * in the active company with exact amount verification (ABS(tx_amount - stored_amount) < 0.01).
 */
function resolveRowDatabaseFirst(
  row: ParsedStatementRow,
  cheques: ChequeEntry[]
): ResolvedRow {
  const rowHasChargeKw = hasChargeKeywords(row.narration);

  if (row.chequeCandidates.length === 0 || cheques.length === 0) {
    return {
      row,
      matchType: 'NONE',
      matchedCheque: null,
      matchedCandidate: null,
      isChargeLike: rowHasChargeKw,
    };
  }

  // Non-return rows (Cleared/Passed) must have a positive transaction amount to match
  if (row.rowType === 'PASSED' && row.amount <= 0) {
    return {
      row,
      matchType: 'NONE',
      matchedCheque: null,
      matchedCandidate: null,
      isChargeLike: false,
    };
  }

  const validPairs: CandidatePair[] = [];
  const last4OnlyPairs: CandidatePair[] = [];

  for (const cand of row.chequeCandidates) {
    for (const cheque of cheques) {
      const storedPadded6 = padCheque6(cheque.chequeNumber);
      const storedLast4 = getLast4Digits(cheque.chequeNumber);

      const isExact6Match = Boolean(
        cand.padded6 && storedPadded6 && cand.padded6 === storedPadded6
      );
      const isLast4Match = Boolean(
        cand.last4 && storedLast4 && cand.last4 === storedLast4
      );

      if (!isExact6Match && !isLast4Match) continue;

      if (row.amount > 0) {
        if (Math.abs(row.amount - cheque.amount) < 0.01) {
          validPairs.push({ cheque, candidate: cand, isExact6Match });
        } else {
          last4OnlyPairs.push({ cheque, candidate: cand, isExact6Match });
        }
      } else {
        // Only Return rows without parsed amount may fall back without amount check
        validPairs.push({ cheque, candidate: cand, isExact6Match });
      }
    }
  }

  if (validPairs.length > 0) {
    const best = pickBestPair(validPairs, row);
    return {
      row,
      matchType: best.isExact6Match ? 'EXACT' : 'LAST_4',
      matchedCheque: best.cheque,
      matchedCandidate: best.candidate,
      isChargeLike: false,
    };
  }

  // Charge/penalty entry sharing last 4 digits with a stored cheque
  if (row.rowType === 'RETURN' && rowHasChargeKw && last4OnlyPairs.length > 0) {
    const bestChargeTarget = pickBestPair(last4OnlyPairs, row);
    return {
      row,
      matchType: 'NONE',
      matchedCheque: bestChargeTarget.cheque,
      matchedCandidate: bestChargeTarget.candidate,
      isChargeLike: true,
    };
  }

  return {
    row,
    matchType: 'NONE',
    matchedCheque: null,
    matchedCandidate: row.chequeCandidates[0] || null,
    isChargeLike: row.rowType === 'RETURN' && rowHasChargeKw,
  };
}

function buildUnmatchedDebugInfo(
  row: ParsedStatementRow,
  cheques: ChequeEntry[],
  ambiguousCheques?: ChequeEntry[]
): UnmatchedReturnDebugInfo {
  const candidateLast4Set = new Set(
    row.chequeCandidates.map((c) => c.last4).filter(Boolean)
  );
  const candidatePaddedSet = new Set(
    row.chequeCandidates.map((c) => c.padded6).filter(Boolean)
  );

  const scoredCheques = cheques
    .map((c) => {
      const padded6 = padCheque6(c.chequeNumber);
      const last4 = getLast4Digits(c.chequeNumber);
      const exactOrLast4Matched =
        candidatePaddedSet.has(padded6) || candidateLast4Set.has(last4);
      const amtDiff = row.amount > 0 ? Math.abs(row.amount - c.amount) : 0;
      const amtMatched = row.amount > 0 && amtDiff < 0.01;

      let mismatchReason = '';
      if (exactOrLast4Matched && !amtMatched) {
        mismatchReason = `Cheque/Last-4 matched (${last4}), amount differed by ₹${amtDiff.toFixed(2)}`;
      } else if (!exactOrLast4Matched && amtMatched) {
        mismatchReason =
          ambiguousCheques && ambiguousCheques.length > 1
            ? `Amount matched (₹${c.amount.toFixed(2)}) — ${ambiguousCheques.length} cheques share this exact amount (manual review)`
            : `Amount matched (₹${c.amount.toFixed(2)}), last-4 (${last4}) not in row candidates`;
      } else {
        mismatchReason = `Neither last-4 (${last4}) nor amount (₹${c.amount.toFixed(2)}) matched`;
      }

      const priority = exactOrLast4Matched ? 0 : amtMatched ? 1 : 2;
      return {
        priority,
        amtDiff,
        comparison: {
          chequeNumber: c.chequeNumber,
          last4,
          amount: c.amount,
          chequeDate: c.chequeDate,
          status: c.status,
          mismatchReason,
        },
      };
    })
    .sort((a, b) => a.priority - b.priority || a.amtDiff - b.amtDiff)
    .slice(0, 5)
    .map((item) => item.comparison);

  return {
    extractedCandidates: row.chequeCandidates.map((c) => ({
      raw: c.rawDigits,
      padded6: c.padded6,
      last4: c.last4,
    })),
    transactionAmount: row.amount,
    closestStoredCheques: scoredCheques,
    manualReviewRequired: Boolean(ambiguousCheques && ambiguousCheques.length > 1),
    ambiguousCheques,
  };
}

function pickPrincipalReturnResolution(
  candidates: ResolvedRow[],
  cheque: ChequeEntry
): ResolvedRow {
  return [...candidates].sort((a, b) => {
    const aAmt = a.row.amount > 0 && Math.abs(cheque.amount - a.row.amount) < 0.01 ? 1 : 0;
    const bAmt = b.row.amount > 0 && Math.abs(cheque.amount - b.row.amount) < 0.01 ? 1 : 0;
    if (aAmt !== bAmt) return bAmt - aAmt;

    const aExact = a.matchType === 'EXACT' ? 1 : 0;
    const bExact = b.matchType === 'EXACT' ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const aHasReason = a.row.detectedReason !== GENERIC_RETURN_REASON ? 1 : 0;
    const bHasReason = b.row.detectedReason !== GENERIC_RETURN_REASON ? 1 : 0;
    if (aHasReason !== bHasReason) return bHasReason - aHasReason;

    const aDebit = a.row.debitAmount > 0 ? 1 : 0;
    const bDebit = b.row.debitAmount > 0 ? 1 : 0;
    if (aDebit !== bDebit) return bDebit - aDebit;

    return a.row.rowIndex - b.row.rowIndex;
  })[0];
}

function pickPrimaryClearedResolution(candidates: ResolvedRow[]): ResolvedRow {
  return [...candidates].sort((a, b) => {
    const aExact = a.matchType === 'EXACT' ? 1 : 0;
    const bExact = b.matchType === 'EXACT' ? 1 : 0;
    if (aExact !== bExact) return bExact - aExact;

    const aCol = a.matchedCandidate?.source === 'column' ? 1 : 0;
    const bCol = b.matchedCandidate?.source === 'column' ? 1 : 0;
    if (aCol !== bCol) return bCol - aCol;

    return a.row.rowIndex - b.row.rowIndex;
  })[0];
}

export async function parseAndReconcileBankStatement(
  file: File,
  cheques: ChequeEntry[],
  batches: ClearingBatch[]
): Promise<StatementParseResult> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const buffer = await file.arrayBuffer();

  let fileType: 'EXCEL' | 'CSV' | 'PDF' = 'CSV';
  let parsedRows: ParsedStatementRow[] = [];

  if (ext === 'pdf') {
    fileType = 'PDF';
    const lines = await parsePdfToLines(buffer);
    parsedRows = parsePdfLines(lines);
  } else {
    fileType = ext === 'csv' ? 'CSV' : 'EXCEL';
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const firstSheetName = workbook.SheetNames[0];
    if (firstSheetName) {
      const sheet = workbook.Sheets[firstSheetName];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        defval: '',
      });
      parsedRows = parseTabularMatrix(matrix);
    }
  }

  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const todayFallback = new Date().toISOString().slice(0, 10);

  // Enforce strict Step A (RETURN) vs Step B (CLEARED) separation:
  // A row can ONLY enter Step A if detectReturnFlag was true (explicit Return/Bounce keyword).
  // Clearing rows (BY CLG, TO CLG, OW CLG, INW CLG, CTS, CHQ PAID, MICR) without return keywords
  // go strictly to Step B.
  const returnRowsRaw = parsedRows.filter((r) => r.isReturnEntry);
  const nonReturnRowsRaw = parsedRows.filter((r) => !r.isReturnEntry);

  // STEP B FIRST-PASS RESOLUTION (Cleared/Passed rows WITHOUT Return Keywords):
  // Match against stored cheques by Cheque No / Last-4 + Amount, or unique Amount fallback on CLG rows.
  const resolvedClearedRows: ResolvedRow[] = nonReturnRowsRaw.map((row) =>
    resolveRowDatabaseFirst(row, cheques)
  );

  for (let i = 0; i < resolvedClearedRows.length; i++) {
    const res = resolvedClearedRows[i];
    if (res.matchedCheque || res.row.amount <= 0) {
      continue;
    }

    // Ignore pure digital transfers (UPI/IMPS/NEFT/RTGS/ATM/POS) without clearing keywords when no cheque matched
    if (isPureDigitalTransfer(res.row.narration)) {
      continue;
    }

    // Only fall back to unique eligible amount on clearing rows that do NOT already carry a non-matching cheque number
    const hasUnmatchedChequeToken =
      res.row.chequeCandidates.some(
        (c) =>
          c.source === 'column' ||
          c.source === 'explicit' ||
          (c.source === 'narration' &&
            c.rawDigits.length >= 4 &&
            c.rawDigits.length <= 6 &&
            !/^20[12]\d/.test(c.rawDigits))
      ) || /\bCLG\/\d{1,8}\b/i.test(res.row.narration);

    if (!hasUnmatchedChequeToken && hasClearingKeywords(res.row.narration)) {
      const eligibleAmountMatches = cheques.filter(
        (c) =>
          c.status !== 'Returned / Bounced' &&
          c.status !== 'Settled / Recovered' &&
          Math.abs(res.row.amount - c.amount) < 0.01
      );
      const pendingPreferred = eligibleAmountMatches.filter((c) =>
        isPendingOrDepositedCheque(c)
      );
      const finalAmountPool =
        pendingPreferred.length === 1
          ? pendingPreferred
          : eligibleAmountMatches;
      if (finalAmountPool.length === 1) {
        resolvedClearedRows[i] = {
          ...res,
          matchType: 'AMOUNT_UNIQUE',
          matchedCheque: finalAmountPool[0],
          matchedCandidate: null,
        };
      }
    }
  }

  // STEP A RESOLUTION (ONLY rows with explicit Return/Bounce keywords):
  // A RETURN row ONLY matches a stored cheque when its extracted cheque number (6-digit or last-4)
  // matches a cheque in the active company. Amount-only / unique-amount fallback is DISABLED for RETURN rows
  // so an unknown returned cheque (e.g. REJECT:865254) can NEVER hijack a different cheque of the same amount.
  const resolvedReturnRows: ResolvedRow[] = returnRowsRaw.map((row) =>
    resolveRowDatabaseFirst(row, cheques)
  );

  // STEP C (Merge Double Entries by stored_cheque_id):
  // - Step A matches -> RETURNED
  // - Step B matches -> CLEARED
  // - If same cheque appears in BOTH Step A and Step B, RETURNED wins.
  // - If cheque only appears in Step B, it MUST stay CLEARED.
  const rowsByChequeId = new Map<string, ResolvedRow[]>();
  const unmatchedReturnResolutions: ResolvedRow[] = [];
  const orphanChargeRows: ParsedStatementRow[] = [];

  for (const res of [...resolvedReturnRows, ...resolvedClearedRows]) {
    if (res.matchedCheque) {
      const list = rowsByChequeId.get(res.matchedCheque.id) || [];
      list.push(res);
      rowsByChequeId.set(res.matchedCheque.id, list);
    } else if (res.row.isReturnEntry) {
      if (res.isChargeLike) {
        orphanChargeRows.push(res.row);
      } else {
        unmatchedReturnResolutions.push(res);
      }
    }
  }

  const returnedMatches: ReconcileMatchCandidate[] = [];
  const clearedMatches: ReconcileClearedCandidate[] = [];
  const ignoredChargeRows: ParsedStatementRow[] = [...orphanChargeRows];
  const ignoredDuplicateRows: ParsedStatementRow[] = [];
  let clearedRowsDetected = 0;

  for (const [chequeId, items] of rowsByChequeId.entries()) {
    const cheque = items[0].matchedCheque!;

    const principalReturnRows: ResolvedRow[] = [];
    const passedRows: ResolvedRow[] = [];
    const chargeRows: ResolvedRow[] = [];

    for (const item of items) {
      if (
        item.isChargeLike ||
        (item.row.isChargeEntry && Math.abs(item.row.amount - cheque.amount) >= 0.01)
      ) {
        chargeRows.push(item);
        continue;
      }

      // Final UI / Bucket Separation Safety Check:
      // 1. If Credit (CR / Deposit) and not explicit Inward return -> ALWAYS CLEARED
      // 2. If !hasReturnKeyword (whole-word) -> ALWAYS CLEARED
      // 3. Only classify as RETURNED when hasReturnKeyword === true AND direction permits it
      const canBeReturn =
        item.row.hasReturnKeyword &&
        (!item.row.isCredit || isInwardReturnPhrase(item.row.narration));

      if (item.row.rowType === 'RETURN' && canBeReturn) {
        principalReturnRows.push(item);
      } else {
        passedRows.push(item);
      }
    }

    clearedRowsDetected += passedRows.length;

    const chargeSum = chargeRows.reduce((s, c) => s + c.row.amount, 0);
    for (const chg of chargeRows) {
      ignoredChargeRows.push(chg.row);
    }

    // Conflict Resolution Rule:
    // If a cheque has BOTH a clearing (PASSED) entry and a RETURN entry, RETURNED always overrides CLEARED
    // and the cheque is placed ONLY in returnedMatches.
    if (principalReturnRows.length > 0) {
      const bestReturn = pickPrincipalReturnResolution(principalReturnRows, cheque);

      let dupCount = 0;
      for (const r of principalReturnRows) {
        if (r !== bestReturn) {
          ignoredDuplicateRows.push(r.row);
          dupCount += 1;
        }
      }
      for (const p of passedRows) {
        ignoredDuplicateRows.push(p.row);
        dupCount += 1;
      }

      let resolvedReason = bestReturn.row.detectedReason;
      if (resolvedReason === GENERIC_RETURN_REASON) {
        const specific = principalReturnRows.find(
          (r) => r.row.detectedReason && r.row.detectedReason !== GENERIC_RETURN_REASON
        );
        if (specific) resolvedReason = specific.row.detectedReason;
      }

      const batch = batchMap.get(cheque.batchId);
      const amountMatches =
        bestReturn.row.amount > 0
          ? Math.abs(cheque.amount - bestReturn.row.amount) < 0.01
          : true;

      returnedMatches.push({
        id: `rec-ret-${bestReturn.row.rowIndex}-${chequeId}`,
        matchType: 'RETURNED',
        matchMethod:
          bestReturn.matchType === 'NONE' ? 'LAST_4' : bestReturn.matchType,
        cheque,
        batchName: batch?.batchRef || 'Unknown Batch',
        isBatchLocked: Boolean(batch?.isLocked),
        statementDate: bestReturn.row.txnDate || todayFallback,
        statementNarration: bestReturn.row.narration,
        statementAmount: bestReturn.row.amount,
        isCredit: bestReturn.row.isCredit,
        txnDirection: bestReturn.row.isCredit
          ? 'CR'
          : bestReturn.row.debitAmount > 0
          ? 'DR'
          : undefined,
        amountMatches,
        detectedReason: resolvedReason,
        alreadyReturned: cheque.status === 'Returned / Bounced',
        matchedStatementNumber:
          bestReturn.matchedCandidate?.rawDigits ||
          bestReturn.matchedCandidate?.normalized ||
          bestReturn.row.chequeNumber ||
          '',
        associatedChargeAmount: chargeSum > 0 ? chargeSum : undefined,
        duplicateRowsSkipped: dupCount > 0 ? dupCount : undefined,
        hasPassedAndReturnedPair: passedRows.length > 0,
      });
      continue;
    }

    // Only clearing (PASSED) entries exist for this cheque in the statement.
    // Never let an older CLEARED row overwrite an existing Returned/Settled cheque in the ledger.
    if (passedRows.length > 0) {
      if (
        cheque.status === 'Returned / Bounced' ||
        cheque.status === 'Settled / Recovered'
      ) {
        for (const p of passedRows) {
          ignoredDuplicateRows.push(p.row);
        }
        continue;
      }

      const bestCleared = pickPrimaryClearedResolution(passedRows);
      let dupCount = 0;
      for (const p of passedRows) {
        if (p !== bestCleared) {
          ignoredDuplicateRows.push(p.row);
          dupCount += 1;
        }
      }

      const batch = batchMap.get(cheque.batchId);
      const clearedMatchMethod: ReconcileClearedCandidate['matchMethod'] =
        bestCleared.matchType === 'EXACT' ||
        bestCleared.matchType === 'AMOUNT_UNIQUE'
          ? bestCleared.matchType
          : 'LAST_4';

      clearedMatches.push({
        id: `rec-clr-${bestCleared.row.rowIndex}-${chequeId}`,
        matchType: 'CLEARED',
        matchMethod: clearedMatchMethod,
        cheque,
        batchName: batch?.batchRef || 'Unknown Batch',
        isBatchLocked: Boolean(batch?.isLocked),
        statementDate: bestCleared.row.txnDate || todayFallback,
        statementNarration: bestCleared.row.narration,
        statementAmount: bestCleared.row.amount,
        isCredit: bestCleared.row.isCredit,
        txnDirection: bestCleared.row.isCredit
          ? 'CR'
          : bestCleared.row.debitAmount > 0
          ? 'DR'
          : undefined,
        amountMatches: Math.abs(cheque.amount - bestCleared.row.amount) < 0.01,
        alreadyCleared: cheque.status === 'Cleared',
        matchedStatementNumber:
          bestCleared.matchedCandidate?.rawDigits ||
          bestCleared.matchedCandidate?.normalized ||
          bestCleared.row.chequeNumber ||
          '',
        duplicateRowsSkipped: dupCount > 0 ? dupCount : undefined,
      });
    }
  }

  // Deduplicate unmatched return rows & attach debug logs
  const unmatchedReturnRows: ParsedStatementRow[] = [];
  const seenUnmatchedKeys = new Set<string>();

  for (const res of unmatchedReturnResolutions) {
    const primaryLast4 =
      res.row.chequeCandidates[0]?.last4 ||
      res.row.chequeCandidates[0]?.normalized ||
      `row-${res.row.rowIndex}`;
    const dedupeKey = `${primaryLast4}|${res.row.txnDate || 'NO_DATE'}|${res.row.amount.toFixed(2)}`;

    if (seenUnmatchedKeys.has(dedupeKey)) {
      ignoredDuplicateRows.push(res.row);
      continue;
    }
    seenUnmatchedKeys.add(dedupeKey);

    const debugInfo = buildUnmatchedDebugInfo(
      res.row,
      cheques,
      res.ambiguousCheques
    );
    console.warn('[BankReconcile] Unmatched return entry:', {
      rowIndex: res.row.rowIndex,
      txnDate: res.row.txnDate,
      narration: res.row.narration,
      extractedCandidates: debugInfo.extractedCandidates,
      transactionAmount: debugInfo.transactionAmount,
      manualReviewRequired: debugInfo.manualReviewRequired,
      closestStoredCheques: debugInfo.closestStoredCheques,
    });

    unmatchedReturnRows.push({
      ...res.row,
      debugInfo,
    });
  }

  return {
    fileName: file.name,
    fileType,
    totalRowsParsed: parsedRows.length,
    returnRowsDetected: returnRowsRaw.length,
    clearedRowsDetected,
    clearedMatches,
    returnedMatches,
    unmatchedReturnRows,
    ignoredChargeRows,
    ignoredDuplicateRows,
  };
}

/**
 * Generates a realistic sample Bank Statement CSV using cheques from the current workspace
 * so Treasury teams can test Auto-Reconciliation formatting immediately.
 */
export function downloadSampleBankStatementCSV(cheques: ChequeEntry[]): void {
  const sampleCheques = cheques.slice(0, 3);
  const rows: string[][] = [
    ['Txn Date', 'Cheque No', 'Narration / Description', 'Debit (INR)', 'Credit (INR)'],
  ];

  if (sampleCheques[0]) {
    const last4 = sampleCheques[0].chequeNumber.slice(-4);
    rows.push([
      '2026-11-17',
      sampleCheques[0].chequeNumber,
      `BY CLG ${sampleCheques[0].chequeNumber} (${sampleCheques[0].partyName})`,
      '0.00',
      sampleCheques[0].amount.toFixed(2),
    ]);
    rows.push([
      '2026-11-18',
      '',
      `BRN/OW RTN CLG: ${sampleCheques[0].amount.toFixed(2)} DR REJECT:${Number(sampleCheques[0].chequeNumber)}:Funds insufficient`,
      sampleCheques[0].amount.toFixed(2),
      '0.00',
    ]);
    rows.push([
      '2026-11-18',
      last4,
      `CHQ RET CHARGES ${last4} + GST`,
      '590.00',
      '0.00',
    ]);
  }
  if (sampleCheques[1]) {
    const last4 = sampleCheques[1].chequeNumber.slice(-4);
    rows.push([
      '2026-11-18',
      '',
      `TO CLG-${last4}-RTN SIGN MISMATCH`,
      sampleCheques[1].amount.toFixed(2),
      '0.00',
    ]);
  }
  if (sampleCheques[2]) {
    rows.push([
      '2026-11-18',
      sampleCheques[2].chequeNumber,
      `BY CLG CTS ${sampleCheques[2].chequeNumber} (${sampleCheques[2].partyName})`,
      '0.00',
      sampleCheques[2].amount.toFixed(2),
    ]);
  }

  const escapeCsv = (val: string) =>
    val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;

  const csv = '\uFEFF' + rows.map((r) => r.map(escapeCsv).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'Sample_Bank_Statement_Return_Reconciliation.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
