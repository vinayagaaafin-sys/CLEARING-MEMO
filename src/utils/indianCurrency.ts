import { ChequeDateEvaluation } from '../types/treasury';

/**
 * Formats a number into exact Indian Numbering System (e.g., 12,45,60,000.00)
 */
export function formatINR(amount: number, includeSymbol = true): string {
  if (!Number.isFinite(amount)) return includeSymbol ? '₹0.00' : '0.00';
  const isNegative = amount < 0;
  const absVal = Math.abs(amount);
  const fixed = absVal.toFixed(2);
  const [intPart, decPart] = fixed.split('.');

  let formattedInt = '';
  if (intPart.length <= 3) {
    formattedInt = intPart;
  } else {
    const lastThree = intPart.slice(-3);
    const remaining = intPart.slice(0, -3);
    const groupedRemaining = remaining.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    formattedInt = `${groupedRemaining},${lastThree}`;
  }

  const sign = isNegative ? '-' : '';
  const prefix = includeSymbol ? '₹' : '';
  return `${sign}${prefix}${formattedInt}.${decPart}`;
}

/**
 * Formats large Indian sums in Crores / Lakhs shorthand for KPI subtitles
 */
export function formatIndianShort(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_00_00_000) {
    return `₹${(amount / 1_00_00_000).toFixed(2)} Cr`;
  }
  if (abs >= 1_00_000) {
    return `₹${(amount / 1_00_000).toFixed(2)} L`;
  }
  return formatINR(amount, true);
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

function twoDigitToWords(num: number): string {
  if (num === 0) return '';
  if (num < 20) return ONES[num];
  const t = Math.floor(num / 10);
  const o = num % 10;
  return o ? `${TENS[t]} ${ONES[o]}` : TENS[t];
}

function threeDigitToWords(num: number): string {
  if (num === 0) return '';
  const h = Math.floor(num / 100);
  const rem = num % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(`${ONES[h]} Hundred`);
  if (rem > 0) parts.push(twoDigitToWords(rem));
  return parts.join(' ');
}

function integerToIndianWords(num: number): string {
  if (num === 0) return 'Zero';

  const parts: string[] = [];

  // Handle Arab / 100+ Crores gracefully: anything >= 1,00,00,000 is expressed in Crores
  // e.g., 124 Crore 56 Lakh...
  const crore = Math.floor(num / 1_00_00_000);
  let remainder = num % 1_00_00_000;

  if (crore > 0) {
    // Recursively format crore count if > 999 Crore
    if (crore >= 1000) {
      parts.push(`${integerToIndianWords(crore)} Crore`);
    } else {
      parts.push(`${threeDigitToWords(crore)} Crore`);
    }
  }

  const lakh = Math.floor(remainder / 1_00_000);
  remainder = remainder % 1_00_000;
  if (lakh > 0) {
    parts.push(`${twoDigitToWords(lakh)} Lakh`);
  }

  const thousand = Math.floor(remainder / 1_000);
  remainder = remainder % 1_000;
  if (thousand > 0) {
    parts.push(`${twoDigitToWords(thousand)} Thousand`);
  }

  if (remainder > 0) {
    parts.push(threeDigitToWords(remainder));
  }

  return parts.join(' ').trim();
}

/**
 * Converts INR amount into official Indian Banking Currency Words
 * e.g., 48562400 -> "Rupees Four Crore Eighty-Five Lakh Sixty-Two Thousand Four Hundred Only"
 */
export function numberToIndianWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    return 'Rupees Zero Only';
  }
  const totalPaise = Math.round(amount * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const rupeeWords = integerToIndianWords(rupees);
  if (paise > 0) {
    const paiseWords = twoDigitToWords(paise);
    return `Rupees ${rupeeWords} and Paise ${paiseWords} Only`;
  }
  return `Rupees ${rupeeWords} Only`;
}

/**
 * Evaluates a cheque date against a deposit/reference date per RBI 3-month (90-day) CTS guidelines
 */
export function evaluateChequeDate(
  chequeDateStr: string,
  depositDateStr: string
): ChequeDateEvaluation {
  if (!chequeDateStr || !depositDateStr) {
    return { flag: 'VALID', daysDiffFromDeposit: 0, message: '' };
  }
  const chq = new Date(`${chequeDateStr}T00:00:00`);
  const dep = new Date(`${depositDateStr}T00:00:00`);
  if (Number.isNaN(chq.getTime()) || Number.isNaN(dep.getTime())) {
    return { flag: 'VALID', daysDiffFromDeposit: 0, message: '' };
  }

  const diffMs = dep.getTime() - chq.getTime();
  const daysDiff = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (daysDiff < 0) {
    const daysFuture = Math.abs(daysDiff);
    return {
      flag: 'PDC',
      daysDiffFromDeposit: daysDiff,
      message: `PDC (+${daysFuture}d ahead of deposit date)`,
    };
  }

  if (daysDiff > 90) {
    return {
      flag: 'STALE',
      daysDiffFromDeposit: daysDiff,
      message: `Stale Cheque (${daysDiff} days old, exceeds 90-day RBI validity)`,
    };
  }

  return {
    flag: 'VALID',
    daysDiffFromDeposit: daysDiff,
    message: `${daysDiff}d old · Valid (${90 - daysDiff}d remaining)`,
  };
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * Generates Corporate Indian Financial Year Batch Ref: CLR/2026-27/NOV/0042
 */
export function generateBatchRef(dateStr: string, sequenceNum: number): string {
  const dt = new Date(`${dateStr}T00:00:00`);
  const year = Number.isNaN(dt.getTime()) ? 2026 : dt.getFullYear();
  const monthIdx = Number.isNaN(dt.getTime()) ? 10 : dt.getMonth();

  // Indian FY starts April (index 3)
  const fyStart = monthIdx >= 3 ? year : year - 1;
  const fyEndShort = String((fyStart + 1) % 100).padStart(2, '0');
  const monthCode = MONTH_ABBR[monthIdx];
  const seqPadded = String(sequenceNum).padStart(4, '0');

  return `CLR/${fyStart}-${fyEndShort}/${monthCode}/${seqPadded}`;
}

/**
 * Format YYYY-MM-DD to DD-MMM-YYYY (e.g., 17-Nov-2026) for official Indian bank memos
 */
export function formatIndianDate(dateStr: string): string {
  if (!dateStr) return '—';
  const dt = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return dateStr;
  const day = String(dt.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day}-${months[dt.getMonth()]}-${dt.getFullYear()}`;
}
