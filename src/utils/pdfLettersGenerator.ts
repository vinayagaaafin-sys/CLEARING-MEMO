import { jsPDF } from 'jspdf';
import { CorporateProfile } from '../types/treasury';
import {
  formatIndianDate,
  formatINR,
  numberToIndianWords,
} from './indianCurrency';
import { getCompanyMonogram } from './pdfReturnAckGenerator';

export interface NocLetterPayload {
  letterDate: string;
  refNo: string;
  customerName: string;
  customerAddress: string;
  loanAccountNo: string;
  loanAmount: number;
  repaymentDate: string;
  paymentMode: string;
  signatoryName: string;
  signatoryDesignation: string;
}

export interface DdCancellationPayload {
  letterDate: string;
  refNo: string;
  bankName: string;
  branchName: string;
  branchAddress?: string;
  accountNumber: string;
  ddNumber: string;
  ddDate: string;
  ddAmount: number;
  payeeName: string;
  cancellationReason: string;
  signatoryName: string;
  signatoryDesignation: string;
}

function asciiSafe(text: string): string {
  return (text || '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u20B9/g, 'Rs. ')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function drawLetterhead(
  doc: jsPDF,
  profile: CorporateProfile,
  badgeText: string,
  letterDate: string,
  refNo: string
): number {
  const marginX = 16;
  const pageW = 210;
  const contentW = pageW - marginX * 2;
  let y = 16;

  // Monogram or Logo
  let logoDrawn = false;
  if (profile.logoDataUrl) {
    try {
      const fmt = profile.logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(profile.logoDataUrl, fmt, marginX, y, 14, 14);
      logoDrawn = true;
    } catch {
      logoDrawn = false;
    }
  }
  if (!logoDrawn) {
    doc.setFillColor(11, 25, 44);
    doc.rect(marginX, y, 14, 14, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(getCompanyMonogram(profile.companyName), marginX + 7, y + 8.5, {
      align: 'center',
    });
  }

  // Company details (left)
  const leftTextX = marginX + 18;
  const maxLeftW = contentW - 64;

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  const compLines = doc.splitTextToSize(
    asciiSafe(profile.companyName).toUpperCase(),
    maxLeftW
  );
  doc.text(compLines, leftTextX, y + 4);
  let leftY = y + 4 + compLines.length * 4.6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  if (profile.registeredAddress) {
    const addrLines = doc.splitTextToSize(
      asciiSafe(profile.registeredAddress),
      maxLeftW
    );
    doc.text(addrLines, leftTextX, leftY);
    leftY += addrLines.length * 3.6;
  }

  const contactParts: string[] = [];
  if (profile.contactPhone) contactParts.push(`Tel: ${asciiSafe(profile.contactPhone)}`);
  if (profile.treasuryEmail) contactParts.push(`Email: ${asciiSafe(profile.treasuryEmail)}`);
  if (contactParts.length > 0) {
    doc.text(contactParts.join('  |  '), leftTextX, leftY);
    leftY += 3.6;
  }

  const statParts: string[] = [];
  if (profile.pan) statParts.push(`PAN: ${asciiSafe(profile.pan)}`);
  if (profile.gstin) statParts.push(`GSTIN: ${asciiSafe(profile.gstin)}`);
  if (profile.cin) statParts.push(`CIN: ${asciiSafe(profile.cin)}`);
  if (statParts.length > 0) {
    doc.setFontSize(7.5);
    doc.text(statParts.join('  |  '), leftTextX, leftY);
    leftY += 3.6;
  }

  // Right metadata badge, Date & Ref
  const rightX = pageW - marginX;
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.35);
  const badgeW = 46;
  doc.rect(rightX - badgeW, y, badgeW, 6);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(asciiSafe(badgeText), rightX - badgeW / 2, y + 4.1, {
    align: 'center',
  });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`Date: ${formatIndianDate(letterDate)}`, rightX, y + 11, {
    align: 'right',
  });
  if (refNo.trim()) {
    doc.text(`Ref: ${asciiSafe(refNo)}`, rightX, y + 15.5, {
      align: 'right',
    });
  }

  const headerBottom = Math.max(leftY + 2, y + 20);
  doc.setDrawColor(15, 23, 42);
  doc.setLineWidth(0.6);
  doc.line(marginX, headerBottom, pageW - marginX, headerBottom);

  return headerBottom + 10;
}

export function generateNocLetterPdf(
  profile: CorporateProfile,
  data: NocLetterPayload
): { filename: string; blobUrl: string } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const marginX = 16;
  const pageW = 210;
  const contentW = pageW - marginX * 2;

  let y = drawLetterhead(
    doc,
    profile,
    'OFFICIAL NOC',
    data.letterDate,
    data.refNo
  );

  // Title: NO OBJECTION CERTIFICATE (NOC)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.5);
  doc.setTextColor(15, 23, 42);
  const title = 'NO OBJECTION CERTIFICATE (NOC)';
  doc.text(title, pageW / 2, y + 2, { align: 'center' });
  const titleW = doc.getTextWidth(title);
  doc.setLineWidth(0.45);
  doc.line(pageW / 2 - titleW / 2, y + 3.5, pageW / 2 + titleW / 2, y + 3.5);
  y += 14;

  // Addressee / Customer block if address present
  const customerName = asciiSafe(data.customerName.trim() || '[Customer Name]');
  const loanAcct = asciiSafe(data.loanAccountNo.trim() || 'N/A');
  const amountFormatted = asciiSafe(formatINR(data.loanAmount || 0, true));
  const amountWords = asciiSafe(numberToIndianWords(data.loanAmount || 0));
  const companyName = asciiSafe(profile.companyName || '[Company Name]');
  const repaymentDateText = data.repaymentDate
    ? formatIndianDate(data.repaymentDate)
    : '[Repayment Date]';
  const paymentModeText = asciiSafe(data.paymentMode.trim() || 'Bank Transfer / Cheque');

  if (data.customerAddress.trim()) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`To: ${customerName}`, marginX, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const custAddrLines = doc.splitTextToSize(
      asciiSafe(data.customerAddress.trim()),
      contentW * 0.7
    );
    doc.text(custAddrLines, marginX, y);
    y += custAddrLines.length * 4 + 6;
  }

  // Body paragraphs
  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);

  const p1 = `This is to certify that M/s. / Mr. / Ms. ${customerName} (Ref / Loan A/c No: ${loanAcct}) had availed a loan / financial facility of ${amountFormatted} (${amountWords}) from ${companyName}.`;
  const p1Lines = doc.splitTextToSize(p1, contentW);
  doc.text(p1Lines, marginX, y);
  y += p1Lines.length * 5.2 + 6;

  const p2 = `We hereby confirm that the entire loan / outstanding amount of ${amountFormatted} has been fully repaid and settled on ${repaymentDateText} via ${paymentModeText}. As of date, there are NO DUES pending against the said account/facility.`;
  const p2Lines = doc.splitTextToSize(p2, contentW);
  doc.text(p2Lines, marginX, y);
  y += p2Lines.length * 5.2 + 6;

  const p3 = `${companyName} has NO OBJECTION whatsoever in releasing any lien, hypothecation, security, or collateral held against the said facility.`;
  const p3Lines = doc.splitTextToSize(p3, contentW);
  doc.text(p3Lines, marginX, y);
  y += p3Lines.length * 5.2 + 10;

  // Summary Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.setLineWidth(0.3);
  doc.rect(marginX, y, contentW, 30, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('SETTLEMENT PARTICULARS', marginX + 4, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(`Borrower / Party: ${customerName}`, marginX + 4, y + 12.5);
  doc.text(`Ref / Loan A/c No: ${loanAcct}`, marginX + contentW / 2, y + 12.5);
  doc.text(`Facility Amount: ${amountFormatted}`, marginX + 4, y + 19);
  doc.text(`Closure Date: ${repaymentDateText}`, marginX + contentW / 2, y + 19);
  doc.text(`Payment Mode / Ref: ${paymentModeText}`, marginX + 4, y + 25.5);

  const safeSlug = (data.customerName || 'Customer')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 28);
  const filename = `NOC_${safeSlug || 'Certificate'}_${data.letterDate || 'Letter'}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return { filename, blobUrl };
}

export function generateDdCancellationPdf(
  profile: CorporateProfile,
  data: DdCancellationPayload
): { filename: string; blobUrl: string } {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const marginX = 16;
  const pageW = 210;
  const contentW = pageW - marginX * 2;

  let y = drawLetterhead(
    doc,
    profile,
    'DD CANCELLATION',
    data.letterDate,
    data.refNo
  );

  const bankName = asciiSafe(data.bankName.trim() || '[Bank Name]');
  const branchName = asciiSafe(data.branchName.trim() || '[Branch Name]');
  const accountNo = asciiSafe(data.accountNumber.trim() || '[Account Number]');
  const ddNo = asciiSafe(data.ddNumber.trim() || '[DD No]');
  const ddDateText = data.ddDate ? formatIndianDate(data.ddDate) : '[DD Date]';
  const ddAmountFormatted = asciiSafe(formatINR(data.ddAmount || 0, true));
  const ddAmountWords = asciiSafe(numberToIndianWords(data.ddAmount || 0));
  const payeeName = asciiSafe(data.payeeName.trim() || '[Payee Name]');
  const reasonText = asciiSafe(
    data.cancellationReason.trim() || 'DD not utilized / Purpose cancelled'
  );
  const companyName = asciiSafe(profile.companyName || '[Company Name]');

  // To Block
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('To,', marginX, y);
  y += 4.5;
  doc.text('The Branch Manager,', marginX, y);
  y += 4.5;
  doc.text(`${bankName},`, marginX, y);
  y += 4.5;
  doc.text(`${branchName}.`, marginX, y);
  if (data.branchAddress?.trim()) {
    y += 4.2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(71, 85, 105);
    const bAddr = doc.splitTextToSize(
      asciiSafe(data.branchAddress.trim()),
      contentW * 0.65
    );
    doc.text(bAddr, marginX, y);
    y += bAddr.length * 3.8;
  }

  y += 7;

  // Subject Line
  const subText = `Sub: Request for Cancellation of Demand Draft (DD No: ${ddNo} dated ${ddDateText} for ${ddAmountFormatted})`;
  doc.setFillColor(241, 245, 249);
  doc.setDrawColor(203, 213, 225);
  const subLines = doc.splitTextToSize(subText, contentW - 6);
  const boxH = subLines.length * 4.8 + 5;
  doc.rect(marginX, y, contentW, boxH, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(subLines, marginX + 3, y + 5);
  y += boxH + 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  doc.text('Dear Sir / Madam,', marginX, y);
  y += 6.5;

  const intro = `With reference to the above subject, we request you to kindly cancel the following Demand Draft issued from our Current / OD Account No. ${accountNo} and credit the proceeds back to our said account at the earliest:`;
  const introLines = doc.splitTextToSize(intro, contentW);
  doc.text(introLines, marginX, y);
  y += introLines.length * 4.8 + 5;

  // Bulleted Particulars Table
  const rows: [string, string][] = [
    ['Demand Draft (DD) Number', ddNo],
    ['DD Date', ddDateText],
    ['DD Amount', `${ddAmountFormatted} (${ddAmountWords})`],
    ['Issued in Favour of (Payee Name)', payeeName],
    ['Reason for Cancellation', reasonText],
  ];

  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.3);
  rows.forEach(([label, value], idx) => {
    const valLines = doc.splitTextToSize(value, contentW - 68);
    const rowH = Math.max(8, valLines.length * 4.5 + 3.5);
    if (idx % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(marginX, y, contentW, rowH, 'FD');
    } else {
      doc.rect(marginX, y, contentW, rowH);
    }
    doc.line(marginX + 62, y, marginX + 62, y + rowH);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(51, 65, 85);
    doc.text(label, marginX + 3, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(valLines, marginX + 65, y + 5);
    y += rowH;
  });

  y += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(30, 41, 59);
  const enclose =
    'We are enclosing the Original Demand Draft along with this letter for your verification and cancellation processing. Kindly deduct any applicable bank cancellation charges from our account.';
  const encloseLines = doc.splitTextToSize(enclose, contentW);
  doc.text(encloseLines, marginX, y);
  y += encloseLines.length * 4.8 + 7;

  doc.text('Thanking you,', marginX, y);

  const safeDd = (data.ddNumber || 'Draft').replace(/[^A-Za-z0-9]+/g, '_');
  const filename = `DD_Cancellation_${safeDd}_${data.letterDate || 'Letter'}.pdf`;
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  return { filename, blobUrl };
}
