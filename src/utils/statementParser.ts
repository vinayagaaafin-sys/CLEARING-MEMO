import * as XLSX from 'xlsx';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BOUNCE_REASONS } from '../data/indianBanks';
import { ChequeEntry, ClearingBatch } from '../types/treasury';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface ParsedStatementRow {
  rowIndex: number;
  txnDate: string; // YYYY-MM-DD or raw string
  narration: string;
  chequeNumber: string;
  debitAmount: number;
  creditAmount: number;
  amount: number;
  isReturnEntry: boolean;
  detectedReason: string;
}

export interface ReconcileMatchCandidate {
  id: string; // unique row key
  cheque: ChequeEntry;
  batchName: string;
  isBatchLocked: boolean;
  statementDate: string;
  statementNarration: string;
  statementAmount: number;
  amountMatches: boolean;
  detectedReason: string;
  alreadyReturned: boolean;
}

export interface StatementParseResult {
  fileName: string;
  fileType: 'EXCEL' | 'CSV' | 'PDF';
  totalRowsParsed: number;
  returnRowsDetected: number;
  matchedCandidates: ReconcileMatchCandidate[];
  unmatchedReturnRows: ParsedStatementRow[];
}

const RETURN_KEYWORDS: RegExp[] = [
  /\bCHQ\s*RET\b/i,
  /\bCHQ\s*RETN\b/i,
  /\bCHEQUE\s*RET(?:URN(?:ED)?)?\b/i,
  /\bCHQ\s*RETURN(?:ED)?\b/i,
  /\bINWARD\s*RET(?:URN)?\b/i,
  /\bOUTWARD\s*RET(?:URN)?\b/i,
  /\bCLG\s*RET(?:URN)?\b/i,
  /\bCLEARING\s*RET(?:URN)?\b/i,
  /\bBOUNCE(?:D)?\b/i,
  /\bDISHONOU?R(?:ED)?\b/i,
  /\bUNPAID\b/i,
  /\bRET(?:URN)?\s*MEMO\b/i,
  /\bINSUFFICIENT\s*FUNDS?\b/i,
  /\bFUNDS?\s*INSUFFICIENT\b/i,
  /\bPAYMENT\s*STOPPED\b/i,
  /\bSTOP\s*PAYMENT\b/i,
  /\bSIGNATURE\s*(?:MISMATCH|DIFFERS|DIFF)\b/i,
  /\bSIGN\s*(?:MISMATCH|DIFFERS|DIFF)\b/i,
  /\bSTALE\s*(?:CHQ|CHEQUE)\b/i,
  /\bREFER\s*TO\s*DRAWER\b/i,
  /\bEXCEEDS\s*ARRANGEMENT\b/i,
  /\bACCOUNT\s*CLOSED\b/i,
  /\bA\/C\s*CLOSED\b/i,
  /\bCHQ\s*REJ(?:ECTED)?\b/i,
  /\bREJ(?:ECTED)?\s*CHQ\b/i,
  /\bI\/W\s*RET\b/i,
  /\bO\/W\s*RET\b/i,
];

const REASON_MATCHERS: { pattern: RegExp; reason: string }[] = [
  {
    pattern: /INSUFFICIENT\s*FUNDS?|FUNDS?\s*INSUFFICIENT|NOT\s*SUFFICIENT|\bNSF\b/i,
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
    pattern: /PAYMENT\s*STOPPED|STOP\s*PAYMENT|STOPPED\s*BY\s*DRAWER/i,
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

function detectReturnFlag(narration: string, statusHint = ''): boolean {
  const combined = `${narration} ${statusHint}`.trim();
  if (!combined) return false;
  if (/\b(?:RETURN(?:ED)?|BOUNCE(?:D)?|UNPAID|DISHONOU?R(?:ED)?)\b/i.test(statusHint)) {
    return true;
  }
  return RETURN_KEYWORDS.some((rx) => rx.test(combined));
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
  // Check if narration explicitly mentions a reason after '-' or ':' or 'REASON'
  const reasonAfterKeyword = narration.match(
    /(?:REASON|RSN|REMARK)\s*[:\-]\s*([A-Za-z0-9\s/,-]{4,60})/i
  );
  if (reasonAfterKeyword?.[1]) {
    return reasonAfterKeyword[1].trim();
  }
  return 'Cheque Returned (Verify Bank Return Memo)';
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

function normalizeDateString(raw: unknown): string {
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(excelEpoch.getTime() + raw * 86400000);
    if (!Number.isNaN(dt.getTime())) {
      return dt.toISOString().slice(0, 10);
    }
  }
  const str = String(raw ?? '').trim();
  if (!str) return new Date().toISOString().slice(0, 10);

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2].padStart(2, '0')}-${isoMatch[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY
  const dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (dmyMatch) {
    const year =
      dmyMatch[3].length === 2 ? `20${dmyMatch[3]}` : dmyMatch[3];
    return `${year}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  // DD-MMM-YYYY or DD MMM YYYY
  const dMonYMatch = str.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})/);
  if (dMonYMatch) {
    const mon = MONTH_MAP[dMonYMatch[2].toLowerCase()];
    if (mon) {
      const year =
        dMonYMatch[3].length === 2 ? `20${dMonYMatch[3]}` : dMonYMatch[3];
      return `${year}-${mon}-${dMonYMatch[1].padStart(2, '0')}`;
    }
  }

  return new Date().toISOString().slice(0, 10);
}

function extractChequeNumber(rawChqCol: unknown, narration: string): string {
  const direct = String(rawChqCol ?? '').replace(/\D/g, '');
  if (direct.length === 6 && direct !== '000000') {
    return direct;
  }
  if (direct.length > 6 && /^0+\d{6}$/.test(direct)) {
    return direct.slice(-6);
  }

  // Look for explicit cheque indicators first
  const labeledMatch = narration.match(
    /(?:CHQ|CHEQUE|INST|INSTRUMENT|CHQ\.?\s*NO\.?|CHQ#|CHQ:|NO\.?)\s*[:#\-/\s]*0*(\d{6})\b/i
  );
  if (labeledMatch?.[1]) {
    return labeledMatch[1];
  }

  // Look for slash/dash delimited 6-digit numbers common in Indian bank narrations (e.g. CLG/482910/ICICI)
  const delimitedMatch = narration.match(/[\/\-:\s]0*(\d{6})(?:[\/\-:\s]|$)/);
  if (delimitedMatch?.[1]) {
    return delimitedMatch[1];
  }

  // Fallback: any standalone 6-digit number in narration
  const standalone = narration.match(/\b(\d{6})\b/);
  return standalone?.[1] || '';
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
    if (candidates.some((cand) => norm.includes(cand))) {
      return orig;
    }
  }
  return undefined;
}

function parseTabularMatrix(matrix: unknown[][]): ParsedStatementRow[] {
  if (matrix.length === 0) return [];

  // Locate header row (first row with >= 2 non-empty cells that looks like bank statement columns)
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
    'particulars',
    'transactiondetails',
    'txndetails',
    'details',
    'remarks',
  ]);
  const chequeKey = findColumnKey(rawHeaders, [
    'chequeno',
    'chequenumber',
    'chqno',
    'chqrefno',
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
    if (!rawRow || rawRow.every((c) => c === null || c === undefined || String(c).trim() === '')) {
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

    const isReturnEntry = detectReturnFlag(narration, `${statusHint} ${reasonHint}`);
    const debitAmount = debitKey ? parseIndianOrNumericAmount(rowObj[debitKey]) : 0;
    const creditAmount = creditKey ? parseIndianOrNumericAmount(rowObj[creditKey]) : 0;
    const genericAmount = amountKey ? parseIndianOrNumericAmount(rowObj[amountKey]) : 0;
    const amount = debitAmount || creditAmount || genericAmount;

    const chequeNumber = extractChequeNumber(
      chequeKey ? rowObj[chequeKey] : '',
      `${narration} ${fallbackText}`
    );

    const txnDate = dateKey
      ? normalizeDateString(rowObj[dateKey])
      : normalizeDateString(fallbackText.match(/\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4}/)?.[0]);

    parsedRows.push({
      rowIndex: r + 1,
      txnDate,
      narration: narration || fallbackText,
      chequeNumber,
      debitAmount,
      creditAmount,
      amount,
      isReturnEntry,
      detectedReason: isReturnEntry ? detectReturnReason(narration, reasonHint) : '',
    });
  }

  return parsedRows;
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
    const isReturnEntry = detectReturnFlag(line);
    const chequeNumber = extractChequeNumber('', line);
    const dateMatch = line.match(
      /\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}[-\s][A-Za-z]{3}[-\s]\d{2,4})\b/
    );
    const txnDate = normalizeDateString(dateMatch?.[1]);

    // Find numeric amounts formatted with decimals (e.g. 1,45,000.00 or 25000.00)
    const amountMatches = Array.from(
      line.matchAll(/\b\d{1,3}(?:,\d{2,3})*\.\d{2}\b|\b\d+\.\d{2}\b/g)
    ).map((m) => parseIndianOrNumericAmount(m[0]));

    const amount = amountMatches.length > 0 ? amountMatches[0] : 0;

    rows.push({
      rowIndex: idx + 1,
      txnDate,
      narration: line,
      chequeNumber,
      debitAmount: amount,
      creditAmount: 0,
      amount,
      isReturnEntry,
      detectedReason: isReturnEntry ? detectReturnReason(line) : '',
    });
  });

  return rows;
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

  const returnRows = parsedRows.filter((r) => r.isReturnEntry);
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const matchedCandidates: ReconcileMatchCandidate[] = [];
  const unmatchedReturnRows: ParsedStatementRow[] = [];
  const alreadyMatchedChequeIds = new Set<string>();

  for (const row of returnRows) {
    if (!row.chequeNumber) {
      unmatchedReturnRows.push(row);
      continue;
    }

    const candidates = cheques.filter(
      (c) =>
        c.chequeNumber.trim() === row.chequeNumber.trim() &&
        !alreadyMatchedChequeIds.has(c.id)
    );

    if (candidates.length === 0) {
      unmatchedReturnRows.push(row);
      continue;
    }

    // Disambiguate by exact amount match when multiple cheques share number
    let bestMatch = candidates[0];
    if (row.amount > 0) {
      const exactAmt = candidates.find(
        (c) => Math.abs(c.amount - row.amount) <= 1.0
      );
      if (exactAmt) bestMatch = exactAmt;
    }

    alreadyMatchedChequeIds.add(bestMatch.id);
    const batch = batchMap.get(bestMatch.batchId);
    const amountMatches =
      row.amount > 0 ? Math.abs(bestMatch.amount - row.amount) <= 1.0 : true;

    matchedCandidates.push({
      id: `rec-${row.rowIndex}-${bestMatch.id}`,
      cheque: bestMatch,
      batchName: batch?.batchRef || 'Unknown Batch',
      isBatchLocked: Boolean(batch?.isLocked),
      statementDate: row.txnDate,
      statementNarration: row.narration,
      statementAmount: row.amount,
      amountMatches,
      detectedReason: row.detectedReason,
      alreadyReturned: bestMatch.status === 'Returned / Bounced',
    });
  }

  return {
    fileName: file.name,
    fileType,
    totalRowsParsed: parsedRows.length,
    returnRowsDetected: returnRows.length,
    matchedCandidates,
    unmatchedReturnRows,
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
    rows.push([
      '2026-11-18',
      sampleCheques[0].chequeNumber,
      `CHQ RETURN - ${sampleCheques[0].chequeNumber} - INSUFFICIENT FUNDS (${sampleCheques[0].partyName})`,
      sampleCheques[0].amount.toFixed(2),
      '0.00',
    ]);
  }
  if (sampleCheques[1]) {
    rows.push([
      '2026-11-18',
      '',
      `CLG CHQ RET/${sampleCheques[1].chequeNumber}/SIGNATURE MISMATCH`,
      sampleCheques[1].amount.toFixed(2),
      '0.00',
    ]);
  }
  if (sampleCheques[2]) {
    rows.push([
      '2026-11-18',
      sampleCheques[2].chequeNumber,
      `INWARD CLEARING SETTLED - CHQ ${sampleCheques[2].chequeNumber} (${sampleCheques[2].partyName})`,
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
