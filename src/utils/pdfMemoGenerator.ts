import { jsPDF } from 'jspdf';
import {
  ChequeEntry,
  ClearingBatch,
  CompanyBankAccount,
  CorporateProfile,
} from '../types/treasury';
import {
  formatIndianDate,
  formatINR,
  numberToIndianWords,
} from './indianCurrency';

export interface MemoDocumentData {
  id: string;
  title: string;
  clearingLabel: string;
  bankAccount: CompanyBankAccount;
  batch: ClearingBatch;
  cheques: ChequeEntry[];
}

export interface PaginatedMemoPage {
  pageNumber: number;
  totalPages: number;
  rows: { serialNo: number; cheque: ChequeEntry }[];
  broughtForward: number;
  pageSubtotal: number;
  carriedForward: number;
  isFirstPage: boolean;
  isLastPage: boolean;
}

/**
 * Deterministic A4 pagination chunker shared by Screen Preview & PDF Engine
 */
export function paginateMemoCheques(cheques: ChequeEntry[]): PaginatedMemoPage[] {
  if (cheques.length === 0) return [];

  const MAX_SINGLE_PAGE = 9;
  const MAX_FIRST_PAGE_MULTI = 18;
  const MAX_MIDDLE_PAGE = 24;
  const MAX_LAST_PAGE = 14;

  const chunks: ChequeEntry[][] = [];

  if (cheques.length <= MAX_SINGLE_PAGE) {
    chunks.push(cheques);
  } else {
    let cursor = 0;
    chunks.push(cheques.slice(cursor, cursor + MAX_FIRST_PAGE_MULTI));
    cursor += MAX_FIRST_PAGE_MULTI;

    while (cursor < cheques.length) {
      const remaining = cheques.length - cursor;
      if (remaining <= MAX_LAST_PAGE) {
        chunks.push(cheques.slice(cursor));
        break;
      } else if (remaining <= MAX_MIDDLE_PAGE) {
        const take = Math.max(1, remaining - Math.min(8, MAX_LAST_PAGE));
        chunks.push(cheques.slice(cursor, cursor + take));
        cursor += take;
      } else {
        chunks.push(cheques.slice(cursor, cursor + MAX_MIDDLE_PAGE));
        cursor += MAX_MIDDLE_PAGE;
      }
    }
  }

  let runningTotal = 0;
  let serial = 1;
  const totalPages = chunks.length;

  return chunks.map((chunk, idx) => {
    const broughtForward = runningTotal;
    const pageSubtotal = chunk.reduce((s, c) => s + c.amount, 0);
    const carriedForward = broughtForward + pageSubtotal;
    runningTotal = carriedForward;

    const rows = chunk.map((cheque) => ({
      serialNo: serial++,
      cheque,
    }));

    return {
      pageNumber: idx + 1,
      totalPages,
      rows,
      broughtForward,
      pageSubtotal,
      carriedForward,
      isFirstPage: idx === 0,
      isLastPage: idx === totalPages - 1,
    };
  });
}

function asciiSafe(text: string): string {
  return (text || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u20B9/g, 'Rs. ')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function fitText(doc: jsPDF, text: string, maxWidth: number): string {
  const safe = asciiSafe(text);
  if (doc.getTextWidth(safe) <= maxWidth) return safe;
  let trimmed = safe;
  while (trimmed.length > 3 && doc.getTextWidth(`${trimmed}...`) > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

/**
 * Generates an official bank-compliant A4 multi-page PDF for all memo documents
 * and triggers an immediate file download (works cleanly even inside sandboxed iframes).
 */
export function generateBankDepositMemoPDF(
  profile: CorporateProfile,
  memoDocuments: MemoDocumentData[],
  batchRefLabel: string
): { filename: string; blobUrl: string } {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const LEFT = 12;
  const RIGHT = 198;
  const WIDTH = RIGHT - LEFT; // 186mm

  // Column X boundaries (sum = 186mm)
  const COLS = [
    { key: 'sno', label: 'S.No', x: 12, w: 10, align: 'center' as const },
    { key: 'date', label: 'Cheque Date', x: 22, w: 23, align: 'left' as const },
    { key: 'chqno', label: 'Cheque No', x: 45, w: 19, align: 'left' as const },
    { key: 'bank', label: 'Drawee Bank & Branch', x: 64, w: 52, align: 'left' as const },
    { key: 'party', label: 'Party Name / Ref', x: 116, w: 51, align: 'left' as const },
    { key: 'amount', label: 'Amount (Rs.)', x: 167, w: 31, align: 'right' as const },
  ];

  let isVeryFirstPdfPage = true;

  for (const doc of memoDocuments) {
    const pages = paginateMemoCheques(doc.cheques);
    const grandTotal = doc.cheques.reduce((s, c) => s + c.amount, 0);

    for (const page of pages) {
      if (!isVeryFirstPdfPage) {
        pdf.addPage('a4', 'portrait');
      }
      isVeryFirstPdfPage = false;

      let y = 13;

      if (page.isFirstPage) {
        // Official Corporate Letterhead
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(15, 23, 42);
        const companyLines = pdf.splitTextToSize(
          asciiSafe(profile.companyName.toUpperCase()),
          115
        );
        pdf.text(companyLines, LEFT, y);

        // Memo Title Box on top right
        pdf.setFontSize(8.5);
        const titleText = asciiSafe(doc.title);
        const boxW = Math.max(62, pdf.getTextWidth(titleText) + 6);
        const boxX = RIGHT - boxW;
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.35);
        pdf.rect(boxX, y - 4.2, boxW, 6);
        pdf.text(titleText, boxX + boxW / 2, y - 0.1, { align: 'center' });

        const addrY = y + companyLines.length * 4.5 + 0.5;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(51, 65, 85);
        const addrLines = pdf.splitTextToSize(
          asciiSafe(profile.registeredAddress),
          115
        );
        pdf.text(addrLines, LEFT, addrY);

        const taxY = addrY + addrLines.length * 3.4 + 0.5;
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(7.5);
        pdf.text(
          asciiSafe(
            `PAN: ${profile.pan}  |  GSTIN: ${profile.gstin}${
              profile.cin ? `  |  CIN: ${profile.cin}` : ''
            }`
          ),
          LEFT,
          taxY
        );

        // Batch metadata right side
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(30, 41, 59);
        pdf.text(`Batch Ref: ${asciiSafe(doc.batch.batchRef)}`, RIGHT, y + 6.5, {
          align: 'right',
        });
        pdf.text(
          `Deposit Date: ${asciiSafe(formatIndianDate(doc.batch.depositDate))}`,
          RIGHT,
          y + 10.8,
          { align: 'right' }
        );
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Page ${page.pageNumber} of ${page.totalPages}`, RIGHT, y + 15.1, {
          align: 'right',
        });

        y = Math.max(taxY + 3, y + 18);
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.6);
        pdf.line(LEFT, y, RIGHT, y);
        y += 3.5;

        // Addressed To & Credit Account Box
        const infoBoxH = 20;
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(148, 163, 184);
        pdf.setLineWidth(0.25);
        pdf.rect(LEFT, y, WIDTH, infoBoxH, 'FD');
        pdf.line(LEFT + WIDTH / 2, y, LEFT + WIDTH / 2, y + infoBoxH);

        // Left half: To Branch Manager
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.8);
        pdf.setTextColor(100, 116, 139);
        pdf.text('TO, THE BRANCH MANAGER', LEFT + 2.5, y + 4);

        pdf.setFontSize(8.2);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          fitText(
            pdf,
            `${doc.bankAccount.bankName} - ${doc.bankAccount.branchName}`,
            WIDTH / 2 - 5
          ),
          LEFT + 2.5,
          y + 8.5
        );

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.3);
        pdf.setTextColor(71, 85, 105);
        const brAddrLines = pdf.splitTextToSize(
          asciiSafe(doc.bankAccount.branchAddress),
          WIDTH / 2 - 5
        );
        pdf.text(brAddrLines.slice(0, 2), LEFT + 2.5, y + 12.8);

        // Right half: Credit Account
        const rx = LEFT + WIDTH / 2 + 2.5;
        const rRight = RIGHT - 2.5;
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.8);
        pdf.setTextColor(100, 116, 139);
        pdf.text('PLEASE CREDIT PROCEEDS TO OUR ACCOUNT', rx, y + 4);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.6);
        pdf.setTextColor(71, 85, 105);
        pdf.text('Account No:', rx, y + 8.8);
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(8.8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(asciiSafe(doc.bankAccount.accountNumber), rRight, y + 8.8, {
          align: 'right',
        });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.6);
        pdf.setTextColor(71, 85, 105);
        pdf.text('Type / IFSC:', rx, y + 13.2);
        pdf.setFont('courier', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          asciiSafe(`${doc.bankAccount.accountType} | ${doc.bankAccount.ifscCode}`),
          rRight,
          y + 13.2,
          { align: 'right' }
        );

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(71, 85, 105);
        pdf.text('Schedule Scope:', rx, y + 17.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(fitText(pdf, doc.clearingLabel, 55), rRight, y + 17.5, {
          align: 'right',
        });

        y += infoBoxH + 3.5;
      } else {
        // Continuation Mini-Header on Page 2+
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          fitText(
            pdf,
            `${profile.companyName.toUpperCase()}  |  ${doc.title}  |  A/c: ${doc.bankAccount.accountNumber}`,
            135
          ),
          LEFT,
          y
        );
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(8);
        pdf.text(
          `${asciiSafe(doc.batch.batchRef)}  |  Page ${page.pageNumber} of ${page.totalPages}`,
          RIGHT,
          y,
          { align: 'right' }
        );
        y += 2.5;
        pdf.setDrawColor(100, 116, 139);
        pdf.setLineWidth(0.35);
        pdf.line(LEFT, y, RIGHT, y);
        y += 3.5;
      }

      // Table Header
      const headerH = 7;
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(100, 116, 139);
      pdf.setLineWidth(0.3);
      pdf.rect(LEFT, y, WIDTH, headerH, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(15, 23, 42);

      for (const col of COLS) {
        if (col.x > LEFT) {
          pdf.setDrawColor(148, 163, 184);
          pdf.line(col.x, y, col.x, y + headerH);
        }
        if (col.align === 'center') {
          pdf.text(col.label, col.x + col.w / 2, y + 4.7, { align: 'center' });
        } else if (col.align === 'right') {
          pdf.text(col.label, col.x + col.w - 2, y + 4.7, { align: 'right' });
        } else {
          pdf.text(col.label, col.x + 1.8, y + 4.7);
        }
      }
      y += headerH;

      // Brought Forward (B/F) row on Page 2+
      if (!page.isFirstPage) {
        const bfH = 6.2;
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(148, 163, 184);
        pdf.rect(LEFT, y, WIDTH, bfH, 'FD');
        pdf.line(167, y, 167, y + bfH);

        pdf.setFont('helvetica', 'bolditalic');
        pdf.setFontSize(7.5);
        pdf.setTextColor(51, 65, 85);
        pdf.text(
          `Brought Forward (B/F) from Page ${page.pageNumber - 1}:`,
          165,
          y + 4.2,
          { align: 'right' }
        );
        pdf.setFont('courier', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(formatINR(page.broughtForward, false), RIGHT - 2, y + 4.2, {
          align: 'right',
        });
        y += bfH;
      }

      // Data Rows
      const rowH = 8.4;
      for (const { serialNo, cheque } of page.rows) {
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.2);
        pdf.rect(LEFT, y, WIDTH, rowH, 'S');
        for (const col of COLS) {
          if (col.x > LEFT) {
            pdf.line(col.x, y, col.x, y + rowH);
          }
        }

        // S.No
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(71, 85, 105);
        pdf.text(String(serialNo), 17, y + 5.2, { align: 'center' });

        // Cheque Date
        pdf.setTextColor(15, 23, 42);
        pdf.text(formatIndianDate(cheque.chequeDate), 23.8, y + 5.2);

        // Cheque No
        pdf.setFont('courier', 'bold');
        pdf.text(asciiSafe(cheque.chequeNumber), 46.8, y + 5.2);

        // Drawee Bank & Branch (2 lines)
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.4);
        pdf.setTextColor(15, 23, 42);
        pdf.text(fitText(pdf, cheque.draweeBank, 48.5), 65.8, y + 3.6);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.6);
        pdf.setTextColor(100, 116, 139);
        pdf.text(fitText(pdf, cheque.draweeBranch, 48.5), 65.8, y + 6.9);

        // Party Name / Ref (2 lines)
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.4);
        pdf.setTextColor(15, 23, 42);
        pdf.text(fitText(pdf, cheque.partyName, 47.5), 117.8, y + 3.6);
        if (cheque.invoiceRef) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(6.5);
          pdf.setTextColor(100, 116, 139);
          pdf.text(fitText(pdf, cheque.invoiceRef, 47.5), 117.8, y + 6.9);
        }

        // Amount
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(7.8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(formatINR(cheque.amount, false), RIGHT - 2, y + 5.2, {
          align: 'right',
        });

        y += rowH;
      }

      // Carried Forward or Grand Total Footer Row
      if (!page.isLastPage) {
        const cfH = 7;
        pdf.setFillColor(241, 245, 249);
        pdf.setDrawColor(100, 116, 139);
        pdf.setLineWidth(0.3);
        pdf.rect(LEFT, y, WIDTH, cfH, 'FD');
        pdf.line(167, y, 167, y + cfH);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          `Carried Forward (C/F) to Page ${page.pageNumber + 1} (Page Subtotal: Rs. ${formatINR(
            page.pageSubtotal,
            false
          )}):`,
          165,
          y + 4.7,
          { align: 'right' }
        );
        pdf.setFont('courier', 'bold');
        pdf.text(formatINR(page.carriedForward, false), RIGHT - 2, y + 4.7, {
          align: 'right',
        });

        // Continuation Footer at bottom of page
        pdf.setDrawColor(203, 213, 225);
        pdf.line(LEFT, 282, RIGHT, 282);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(100, 116, 139);
        pdf.text(
          fitText(pdf, `${profile.companyName} | Batch ${doc.batch.batchRef}`, 120),
          LEFT,
          286.5
        );
        pdf.text(`Continued on Page ${page.pageNumber + 1}...`, RIGHT, 286.5, {
          align: 'right',
        });
      } else {
        // Grand Total Row
        const gtH = 8;
        pdf.setFillColor(241, 245, 249);
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.45);
        pdf.rect(LEFT, y, WIDTH, gtH, 'FD');
        pdf.line(167, y, 167, y + gtH);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.2);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          `GRAND TOTAL (${doc.cheques.length} Instruments):`,
          165,
          y + 5.3,
          { align: 'right' }
        );
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(8.3);
        pdf.text(`Rs. ${formatINR(grandTotal, false)}`, RIGHT - 2, y + 5.3, {
          align: 'right',
        });
        y += gtH + 3;

        // Amount in Indian Words Box
        const wordsStr = asciiSafe(
          `Amount in Words: ${numberToIndianWords(grandTotal)}`
        );
        const wordsLines = pdf.splitTextToSize(wordsStr, WIDTH - 6);
        const wordsH = Math.max(8, wordsLines.length * 3.8 + 3.5);
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(148, 163, 184);
        pdf.setLineWidth(0.25);
        pdf.rect(LEFT, y, WIDTH, wordsH, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(wordsLines, LEFT + 3, y + 4.8);

        // Anchor Maker-Checker + Bank Teller Receipt at bottom of final A4 page
        const footerTop = Math.max(y + wordsH + 6, 218);

        // Maker & Checker Audit Row (height 10mm)
        const colW = (WIDTH - 6) / 2;
        const sigY = footerTop;
        const sigH = 10;

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.2);
        pdf.setTextColor(71, 85, 105);
        pdf.text('Prepared By (Maker):', LEFT, sigY + 3.5);
        pdf.setFont('helvetica', 'normal');
        pdf.text(fitText(pdf, doc.batch.makerName, colW), LEFT, sigY + 7.2);

        const checkerX = LEFT + colW + 6;
        pdf.setFont('helvetica', 'bold');
        pdf.text('Verified By (Checker):', checkerX, sigY + 3.5);
        pdf.setFont('helvetica', 'normal');
        pdf.text(fitText(pdf, doc.batch.checkerName, colW), checkerX, sigY + 7.2);

        // Perforated Divider
        const perfY = sigY + sigH + 4;
        pdf.setDrawColor(100, 116, 139);
        pdf.setLineWidth(0.35);
        pdf.setLineDashPattern([2, 1.5], 0);
        pdf.line(LEFT, perfY, RIGHT, perfY);
        pdf.setLineDashPattern([], 0);

        // Bank Teller Acknowledgement Receipt Box (Medium Size)
        const recY = perfY + 3.5;
        const recH = 42;
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.35);
        pdf.rect(LEFT, recY, WIDTH, recH, 'FD');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          'BANK ACKNOWLEDGEMENT RECEIPT',
          LEFT + 4,
          recY + 6
        );
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(71, 85, 105);
        pdf.text(
          `Batch: ${asciiSafe(doc.batch.batchRef)} | ${formatIndianDate(
            doc.batch.depositDate
          )}`,
          RIGHT - 4,
          recY + 6,
          { align: 'right' }
        );

        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.2);
        pdf.line(LEFT + 4, recY + 8.5, RIGHT - 4, recY + 8.5);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(30, 41, 59);
        const ackLine1 = fitText(
          pdf,
          `Received from ${profile.companyName}`,
          86
        );
        const ackLine2 = fitText(
          pdf,
          `Credit to ${doc.bankAccount.bankName} A/c ${doc.bankAccount.accountNumber}`,
          86
        );
        pdf.text(ackLine1, LEFT + 4, recY + 14.5);
        pdf.text(ackLine2, LEFT + 4, recY + 19);
        pdf.text(
          fitText(pdf, `Schedule: ${doc.clearingLabel}`, 86),
          LEFT + 4,
          recY + 23.5
        );

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(15, 23, 42);
        pdf.text(`Total Cheques: ${doc.cheques.length}`, LEFT + 4, recY + 30.5);
        pdf.text(
          `Total Amount: Rs. ${formatINR(grandTotal, false)}`,
          LEFT + 38,
          recY + 30.5
        );

        pdf.setFont('helvetica', 'italic');
        pdf.setFontSize(7);
        pdf.setTextColor(100, 116, 139);
        pdf.text(
          'Subject to realization under CTS / RBI Clearing Rules.',
          LEFT + 4,
          recY + 37.5
        );

        // Stamp & Officer Sign Boxes inside Teller Receipt (Medium Size)
        const stampX = LEFT + 94;
        const boxW = 42;
        const boxHeight = 27;
        const boxTop = recY + 11.5;
        pdf.setDrawColor(148, 163, 184);
        pdf.setLineDashPattern([1.2, 1.2], 0);
        pdf.rect(stampX, boxTop, boxW, boxHeight, 'S');
        pdf.setLineDashPattern([], 0);
        pdf.rect(stampX + boxW + 4, boxTop, boxW, boxHeight, 'S');

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.2);
        pdf.setTextColor(71, 85, 105);
        pdf.text('Bank Branch Stamp', stampX + boxW / 2, boxTop + boxHeight - 2.5, {
          align: 'center',
        });
        pdf.text(
          'Receiving Officer Sign & Time',
          stampX + boxW + 4 + boxW / 2,
          boxTop + boxHeight - 2.5,
          { align: 'center' }
        );
      }
    }
  }

  const safeBatchRef = asciiSafe(batchRefLabel).replace(/[^A-Za-z0-9_-]/g, '-');
  const filename = `ClearLedger_Deposit_Memo_${safeBatchRef}.pdf`;
  const blob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  // Direct download trigger (works cleanly inside iframes)
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return { filename, blobUrl };
}
