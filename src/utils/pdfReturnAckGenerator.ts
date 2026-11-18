import { jsPDF } from 'jspdf';
import {
  BearerAuthorization,
  ChequeEntry,
  CompanyBankAccount,
  CorporateProfile,
} from '../types/treasury';
import {
  formatIndianDate,
  formatINR,
  numberToIndianWords,
} from './indianCurrency';

export interface ReturnAckDocumentData {
  id: string;
  referenceNo: string;
  bankAccount: CompanyBankAccount;
  cheques: ChequeEntry[];
}

export interface PaginatedReturnPage {
  pageNumber: number;
  totalPages: number;
  rows: { serialNo: number; cheque: ChequeEntry }[];
  isFirstPage: boolean;
  isLastPage: boolean;
}

export function getCompanyMonogram(companyName: string): string {
  const words = (companyName || 'CL')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0 && !['pvt', 'ltd', 'llp', 'and', 'of', 'the'].includes(w.toLowerCase()));
  if (words.length === 0) return 'CL';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function paginateReturnCheques(cheques: ChequeEntry[]): PaginatedReturnPage[] {
  if (cheques.length === 0) return [];

  const MAX_SINGLE_PAGE = 9;
  const MAX_FIRST_PAGE_MULTI = 14;
  const MAX_MIDDLE_PAGE = 20;
  const MAX_LAST_PAGE = 10;

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
        const take = Math.max(1, remaining - Math.min(6, MAX_LAST_PAGE));
        chunks.push(cheques.slice(cursor, cursor + take));
        cursor += take;
      } else {
        chunks.push(cheques.slice(cursor, cursor + MAX_MIDDLE_PAGE));
        cursor += MAX_MIDDLE_PAGE;
      }
    }
  }

  let serial = 1;
  const totalPages = chunks.length;

  return chunks.map((chunk, idx) => ({
    pageNumber: idx + 1,
    totalPages,
    rows: chunk.map((cheque) => ({
      serialNo: serial++,
      cheque,
    })),
    isFirstPage: idx === 0,
    isLastPage: idx === totalPages - 1,
  }));
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

export function generateReturnAcknowledgementPDF(params: {
  profile: CorporateProfile;
  documents: ReturnAckDocumentData[];
  letterDate: string;
  bearer: BearerAuthorization;
  signatoryName: string;
  signatoryDesignation: string;
  scopeLabel: string;
}): { filename: string; blobUrl: string } {
  const {
    profile,
    documents,
    letterDate,
    bearer,
    signatoryName,
    signatoryDesignation,
    scopeLabel,
  } = params;

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const LEFT = 12;
  const RIGHT = 198;
  const WIDTH = RIGHT - LEFT; // 186mm

  // Required 6 columns (sum = 186mm)
  const COLS = [
    { key: 'sno', label: 'S.No', x: 12, w: 10, align: 'center' as const },
    { key: 'chqno', label: 'Cheque No.', x: 22, w: 23, align: 'left' as const },
    { key: 'date', label: 'Cheque Date', x: 45, w: 23, align: 'left' as const },
    { key: 'customer', label: 'Customer Name', x: 68, w: 47, align: 'left' as const },
    { key: 'amount', label: 'Amount (Rs.)', x: 115, w: 32, align: 'right' as const },
    { key: 'reason', label: 'Reason of Return', x: 147, w: 51, align: 'left' as const },
  ];

  let isFirstPdfPage = true;

  for (const docItem of documents) {
    const pages = paginateReturnCheques(docItem.cheques);
    const grandTotal = docItem.cheques.reduce((s, c) => s + c.amount, 0);

    for (const page of pages) {
      if (!isFirstPdfPage) {
        pdf.addPage('a4', 'portrait');
      }
      isFirstPdfPage = false;

      let y = 13;

      if (page.isFirstPage) {
        // Official Corporate Letterhead with Logo / Monogram
        const logoSize = 13;
        let drawnImage = false;
        if (
          profile.logoDataUrl &&
          (profile.logoDataUrl.startsWith('data:image/png') ||
            profile.logoDataUrl.startsWith('data:image/jpeg') ||
            profile.logoDataUrl.startsWith('data:image/jpg'))
        ) {
          try {
            const imgType = profile.logoDataUrl.startsWith('data:image/png') ? 'PNG' : 'JPEG';
            pdf.addImage(profile.logoDataUrl, imgType, LEFT, y - 3, logoSize, logoSize);
            drawnImage = true;
          } catch {
            drawnImage = false;
          }
        }
        if (!drawnImage) {
          pdf.setFillColor(11, 25, 44);
          pdf.rect(LEFT, y - 3, logoSize, logoSize, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(11);
          pdf.setTextColor(255, 255, 255);
          pdf.text(getCompanyMonogram(profile.companyName), LEFT + logoSize / 2, y + 5, {
            align: 'center',
          });
        }

        const textLeft = LEFT + logoSize + 4;
        const maxLeftWidth = 104;

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11.5);
        pdf.setTextColor(15, 23, 42);
        const companyLines = pdf.splitTextToSize(
          asciiSafe(profile.companyName.toUpperCase()),
          maxLeftWidth
        );
        pdf.text(companyLines, textLeft, y);

        const addrY = y + companyLines.length * 4.3 + 0.4;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.3);
        pdf.setTextColor(51, 65, 85);
        const addrLines = pdf.splitTextToSize(
          asciiSafe(profile.registeredAddress),
          maxLeftWidth
        );
        pdf.text(addrLines, textLeft, addrY);

        const contactY = addrY + addrLines.length * 3.3 + 0.5;
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.2);
        pdf.setTextColor(71, 85, 105);
        const contactParts = [
          profile.contactPhone ? `Tel: ${profile.contactPhone}` : '',
          profile.treasuryEmail ? `Email: ${profile.treasuryEmail}` : '',
        ].filter(Boolean);
        if (contactParts.length > 0) {
          pdf.text(asciiSafe(contactParts.join('  |  ')), textLeft, contactY);
        }

        const taxY = contactY + (contactParts.length > 0 ? 3.5 : 0);
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(7);
        pdf.text(
          asciiSafe(`PAN: ${profile.pan}  |  GSTIN: ${profile.gstin}`),
          textLeft,
          taxY
        );

        // Right metadata: Letter Ref & Current Date
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(15, 23, 42);
        pdf.text('RETURN CHEQUE ACKNOWLEDGEMENT', RIGHT, y, { align: 'right' });

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.8);
        pdf.setTextColor(51, 65, 85);
        pdf.text(`Date: ${asciiSafe(formatIndianDate(letterDate))}`, RIGHT, y + 5.2, {
          align: 'right',
        });
        pdf.text(`Ref: ${asciiSafe(docItem.referenceNo)}`, RIGHT, y + 9.4, {
          align: 'right',
        });
        pdf.setFont('helvetica', 'bold');
        pdf.text(`Page ${page.pageNumber} of ${page.totalPages}`, RIGHT, y + 13.6, {
          align: 'right',
        });

        y = Math.max(taxY + 3.5, y + 16);
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.6);
        pdf.line(LEFT, y, RIGHT, y);
        y += 5;

        // Addressed To: The Branch Manager
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.2);
        pdf.setTextColor(15, 23, 42);
        pdf.text('To,', LEFT, y);
        pdf.text('The Branch Manager,', LEFT, y + 4.2);
        pdf.text(
          asciiSafe(`${docItem.bankAccount.bankName} - ${docItem.bankAccount.branchName}`),
          LEFT,
          y + 8.4
        );
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.6);
        pdf.setTextColor(71, 85, 105);
        const branchAddrLines = pdf.splitTextToSize(
          asciiSafe(docItem.bankAccount.branchAddress),
          110
        );
        pdf.text(branchAddrLines.slice(0, 2), LEFT, y + 12.4);

        // Right side account box
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.6);
        pdf.text(
          asciiSafe(`Account No: ${docItem.bankAccount.accountNumber}`),
          RIGHT,
          y + 4.2,
          { align: 'right' }
        );
        pdf.text(
          asciiSafe(`IFSC: ${docItem.bankAccount.ifscCode}`),
          RIGHT,
          y + 8.4,
          { align: 'right' }
        );

        y += 14 + branchAddrLines.slice(0, 2).length * 3.4;

        // Clear Subject Line
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(203, 213, 225);
        pdf.setLineWidth(0.25);
        pdf.rect(LEFT, y, WIDTH, 7.5, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8.5);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          'Subject: Acknowledgement & Authorization for Collection of Returned Cheque(s)',
          LEFT + 3,
          y + 5
        );
        y += 11;

        // Salutation & Body Paragraph
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8.2);
        pdf.setTextColor(30, 41, 59);
        const introText = asciiSafe(
          `Dear Sir/Madam, We hereby authorize our representative named below to collect the original dishonoured / returned cheque(s) along with the respective Bank Return Memo(s) pertaining to our ${docItem.bankAccount.accountType} (${docItem.bankAccount.accountNumber}) as detailed below:`
        );
        const introLines = pdf.splitTextToSize(introText, WIDTH);
        pdf.text(introLines, LEFT, y);
        y += introLines.length * 3.8 + 2.5;
      } else {
        // Continuation Header
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          fitText(
            pdf,
            `${profile.companyName.toUpperCase()}  |  RETURN CHEQUE ACKNOWLEDGEMENT  |  ${docItem.bankAccount.bankName}`,
            135
          ),
          LEFT,
          y
        );
        pdf.setFont('courier', 'bold');
        pdf.text(
          `${asciiSafe(docItem.referenceNo)}  |  Page ${page.pageNumber} of ${page.totalPages}`,
          RIGHT,
          y,
          { align: 'right' }
        );
        y += 2.5;
        pdf.setDrawColor(100, 116, 139);
        pdf.setLineWidth(0.35);
        pdf.line(LEFT, y, RIGHT, y);
        y += 4;
      }

      // Summary Table Header
      const headerH = 7.5;
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(100, 116, 139);
      pdf.setLineWidth(0.3);
      pdf.rect(LEFT, y, WIDTH, headerH, 'FD');

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(7.4);
      pdf.setTextColor(15, 23, 42);
      for (const col of COLS) {
        if (col.x > LEFT) {
          pdf.setDrawColor(148, 163, 184);
          pdf.line(col.x, y, col.x, y + headerH);
        }
        if (col.align === 'center') {
          pdf.text(col.label, col.x + col.w / 2, y + 4.9, { align: 'center' });
        } else if (col.align === 'right') {
          pdf.text(col.label, col.x + col.w - 2, y + 4.9, { align: 'right' });
        } else {
          pdf.text(col.label, col.x + 1.8, y + 4.9);
        }
      }
      y += headerH;

      // Data Rows
      for (const { serialNo, cheque } of page.rows) {
        const reasonStr = asciiSafe(cheque.bounceReason || 'Reason Not Specified');
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        const reasonLines = pdf.splitTextToSize(reasonStr, 47.5).slice(0, 2);
        const rowH = Math.max(9.2, reasonLines.length * 3.5 + 3.2);

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

        // Cheque Number
        pdf.setFont('courier', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(asciiSafe(cheque.chequeNumber), 23.8, y + 5.2);

        // Cheque Date
        pdf.setFont('courier', 'normal');
        pdf.text(formatIndianDate(cheque.chequeDate), 46.8, y + 5.2);

        // Customer Name
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.3);
        pdf.text(fitText(pdf, cheque.partyName, 43.5), 69.8, y + (cheque.invoiceRef ? 4 : 5.2));
        if (cheque.invoiceRef) {
          pdf.setFont('courier', 'normal');
          pdf.setFontSize(6.6);
          pdf.setTextColor(100, 116, 139);
          pdf.text(fitText(pdf, cheque.invoiceRef, 43.5), 69.8, y + 7.2);
        }

        // Amount (Rs.)
        pdf.setFont('courier', 'bold');
        pdf.setFontSize(7.6);
        pdf.setTextColor(15, 23, 42);
        pdf.text(formatINR(cheque.amount, false), 145, y + 5.2, {
          align: 'right',
        });

        // Reason of Return
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7);
        pdf.setTextColor(153, 27, 27);
        pdf.text(reasonLines, 148.8, y + 4.1);

        y += rowH;
      }

      if (!page.isLastPage) {
        pdf.setDrawColor(203, 213, 225);
        pdf.line(LEFT, 282, RIGHT, 282);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(100, 116, 139);
        pdf.text(
          fitText(pdf, `${profile.companyName} | ${docItem.referenceNo}`, 120),
          LEFT,
          286.5
        );
        pdf.text(`Continued on Page ${page.pageNumber + 1}...`, RIGHT, 286.5, {
          align: 'right',
        });
      } else {
        // Grand Total Row
        const gtH = 7.8;
        pdf.setFillColor(241, 245, 249);
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.4);
        pdf.rect(LEFT, y, WIDTH, gtH, 'FD');
        pdf.line(115, y, 115, y + gtH);
        pdf.line(147, y, 147, y + gtH);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          `TOTAL RETURNED CHEQUES (${docItem.cheques.length}):`,
          113,
          y + 5.2,
          { align: 'right' }
        );
        pdf.setFont('courier', 'bold');
        pdf.text(`Rs. ${formatINR(grandTotal, false)}`, 145, y + 5.2, {
          align: 'right',
        });
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(71, 85, 105);
        pdf.text('Collect with Return Memo(s)', 148.8, y + 5.2);
        y += gtH + 3;

        // Amount in words
        const wordsLines = pdf.splitTextToSize(
          asciiSafe(`Total Return Value in Words: ${numberToIndianWords(grandTotal)}`),
          WIDTH - 6
        );
        const wordsH = Math.max(7.5, wordsLines.length * 3.8 + 3);
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(148, 163, 184);
        pdf.setLineWidth(0.25);
        pdf.rect(LEFT, y, WIDTH, wordsH, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.6);
        pdf.setTextColor(15, 23, 42);
        pdf.text(wordsLines, LEFT + 3, y + 4.7);
        y += wordsH + 5;

        // Closing Declaration
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.8);
        pdf.setTextColor(51, 65, 85);
        pdf.text(
          'Kindly hand over the above original returned cheque(s) and Return Memo(s) to the authorized bearer against verification of ID proof.',
          LEFT,
          y
        );
        y += 6;

        // Anchor Bearer Authorization & Company Authorized Signatory at bottom
        const blockTop = Math.max(y, 206);
        const bearerH = 38;

        // Left: Bearer / Employee Authorization Box (104mm)
        const bearerW = 108;
        pdf.setFillColor(248, 250, 252);
        pdf.setDrawColor(100, 116, 139);
        pdf.setLineWidth(0.3);
        pdf.rect(LEFT, blockTop, bearerW, bearerH, 'FD');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.setTextColor(15, 23, 42);
        pdf.text('BEARER / EMPLOYEE AUTHORIZATION', LEFT + 3.5, blockTop + 5.5);
        pdf.setDrawColor(203, 213, 225);
        pdf.line(LEFT + 3.5, blockTop + 7.5, LEFT + bearerW - 3.5, blockTop + 7.5);

        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(71, 85, 105);
        pdf.text('Bearer Name:', LEFT + 3.5, blockTop + 12.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          fitText(pdf, bearer.bearerName || '______________________________', 72),
          LEFT + 28,
          blockTop + 12.5
        );

        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(71, 85, 105);
        pdf.text('Designation / ID:', LEFT + 3.5, blockTop + 17.5);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          fitText(pdf, bearer.bearerDesignation || '______________________________', 72),
          LEFT + 28,
          blockTop + 17.5
        );

        pdf.setTextColor(71, 85, 105);
        pdf.text('ID Proof:', LEFT + 3.5, blockTop + 22.5);
        pdf.setFont('courier', 'bold');
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          fitText(
            pdf,
            `${bearer.idProofType}: ${bearer.idProofNumber || '____________________'}`,
            72
          ),
          LEFT + 28,
          blockTop + 22.5
        );

        // Specimen Signature box inside Bearer card
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(71, 85, 105);
        pdf.text('Specimen Signature of Bearer:', LEFT + 3.5, blockTop + 31);
        pdf.setDrawColor(148, 163, 184);
        pdf.rect(LEFT + 44, blockTop + 26, 60, 9.5, 'S');

        // Right: Company Authorized Signatory & Stamp Box (74mm)
        const sigX = LEFT + bearerW + 4;
        const sigW = WIDTH - bearerW - 4; // 74mm
        pdf.setFillColor(255, 255, 255);
        pdf.setDrawColor(15, 23, 42);
        pdf.setLineWidth(0.3);
        pdf.rect(sigX, blockTop, sigW, bearerH, 'FD');

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.4);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          fitText(pdf, `For ${profile.companyName}`, sigW - 6),
          sigX + 3,
          blockTop + 5.5
        );

        // Stamp placeholder
        pdf.setDrawColor(148, 163, 184);
        pdf.setLineDashPattern([1, 1], 0);
        pdf.rect(sigX + sigW - 23, blockTop + 8.5, 20, 16, 'S');
        pdf.setLineDashPattern([], 0);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.2);
        pdf.setTextColor(100, 116, 139);
        pdf.text('Company', sigX + sigW - 13, blockTop + 15.5, { align: 'center' });
        pdf.text('Stamp', sigX + sigW - 13, blockTop + 18.5, { align: 'center' });

        // Signatory details at bottom of box
        pdf.setDrawColor(100, 116, 139);
        pdf.line(sigX + 3, blockTop + 26.5, sigX + sigW - 26, blockTop + 26.5);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.3);
        pdf.setTextColor(15, 23, 42);
        pdf.text(fitText(pdf, signatoryName || 'Authorized Signatory', sigW - 6), sigX + 3, blockTop + 31);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6.8);
        pdf.setTextColor(71, 85, 105);
        pdf.text(
          fitText(pdf, signatoryDesignation || 'Authorized Signatory', sigW - 6),
          sigX + 3,
          blockTop + 35
        );

        // Bank Counter Acknowledgement Strip below
        const ackY = blockTop + bearerH + 4;
        pdf.setDrawColor(148, 163, 184);
        pdf.setLineDashPattern([1.8, 1.2], 0);
        pdf.line(LEFT, ackY, RIGHT, ackY);
        pdf.setLineDashPattern([], 0);

        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.3);
        pdf.setTextColor(71, 85, 105);
        pdf.text(
          'BANK COUNTER ACKNOWLEDGEMENT (For Bank / Bearer Use):',
          LEFT,
          ackY + 4.5
        );
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.2);
        pdf.text(
          `Received ${docItem.cheques.length} original returned cheque(s) & Return Memo(s) in good order.`,
          LEFT,
          ackY + 9
        );
        pdf.text('Bearer Signature & Date: ___________________________', LEFT, ackY + 15);
        pdf.text('Bank Officer Sign & Stamp: ___________________________', RIGHT, ackY + 15, {
          align: 'right',
        });
      }
    }
  }

  const safeLabel = asciiSafe(scopeLabel).replace(/[^A-Za-z0-9_-]/g, '-');
  const filename = `ClearLedger_Return_Acknowledgement_${safeLabel}.pdf`;
  const blob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return { filename, blobUrl };
}
