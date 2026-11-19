import { jsPDF } from 'jspdf';
import {
  CompanyWorkspace,
  CustomerChequeSchedule,
} from '../types/treasury';
import {
  CustomerSummaryItem,
  resolveInstallmentPaidInfo,
} from './customerHelpers';
import { formatIndianDate, formatINR } from './indianCurrency';
import {
  computeScheduleRowsWithBalance,
  getFrequencyLabel,
  getInterestTypeLabel,
  round2,
} from './loanCalculator';
import { getCompanyMonogram } from './pdfReturnAckGenerator';

function asciiSafe(text: string): string {
  return (text || '')
    .replace(/\u20B9/g, 'Rs. ')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fitText(pdf: jsPDF, text: string, maxWidth: number): string {
  const safe = asciiSafe(text);
  if (!safe) return '';
  if (pdf.getTextWidth(safe) <= maxWidth) return safe;
  let truncated = safe;
  while (
    truncated.length > 3 &&
    pdf.getTextWidth(`${truncated}...`) > maxWidth
  ) {
    truncated = truncated.slice(0, -1);
  }
  return `${truncated}...`;
}

function getScheduleTotals(
  sch: CustomerChequeSchedule,
  chequeById: Map<string, CompanyWorkspace['cheques'][number]>
) {
  const rows = sch.cheques || [];
  const totalPayable = round2(
    sch.totalPayable ?? rows.reduce((s, r) => s + (r.amount || 0), 0)
  );
  const principal = round2(
    sch.principalAmount ??
      rows.reduce((s, r) => s + (r.principalAmount ?? r.amount ?? 0), 0)
  );
  const interest = round2(
    sch.totalInterest ??
      rows.reduce((s, r) => s + (r.interestAmount ?? 0), 0)
  );
  let paidAmount = 0;
  let paidCount = 0;
  for (const row of rows) {
    const info = resolveInstallmentPaidInfo(row, chequeById);
    if (info.isPaid) {
      paidAmount += row.amount || 0;
      paidCount += 1;
    }
  }
  paidAmount = round2(paidAmount);
  const balance = Math.max(0, round2(totalPayable - paidAmount));
  return {
    totalPayable,
    principal,
    interest,
    paidAmount,
    paidCount,
    balance,
  };
}

export function generateCustomerStatementPdf(
  company: CompanyWorkspace,
  customer: CustomerSummaryItem
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
  const PAGE_BOTTOM = 278;

  const todayIso = new Date().toISOString().slice(0, 10);
  const chequeById = new Map(company.cheques.map((c) => [c.id, c]));
  const batchById = new Map(company.batches.map((b) => [b.id, b]));
  const profile = company.profile;
  const cust = customer.profile;

  let y = 14;

  const drawTopLetterhead = (isContinuation: boolean) => {
    if (isContinuation) {
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9.5);
      pdf.setTextColor(15, 23, 42);
      pdf.text(
        fitText(
          pdf,
          `${profile.companyName} - Customer Loan & Payment Statement`,
          130
        ),
        LEFT,
        y
      );
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(71, 85, 105);
      pdf.text(
        fitText(
          pdf,
          `Customer: ${cust.partyName} (${cust.customerCode || '-'}) | Date: ${formatIndianDate(todayIso)}`,
          WIDTH
        ),
        LEFT,
        y + 4.6
      );
      y += 7.2;
      pdf.setDrawColor(15, 23, 42);
      pdf.setLineWidth(0.4);
      pdf.line(LEFT, y, RIGHT, y);
      y += 5;
      return;
    }

    // Full Corporate Letterhead on Page 1
    let logoDrawn = false;
    if (profile.logoDataUrl) {
      try {
        const fmt = profile.logoDataUrl.includes('image/png') ? 'PNG' : 'JPEG';
        pdf.addImage(profile.logoDataUrl, fmt, LEFT, y, 13, 13);
        logoDrawn = true;
      } catch {
        logoDrawn = false;
      }
    }
    if (!logoDrawn) {
      pdf.setFillColor(11, 25, 44);
      pdf.rect(LEFT, y, 13, 13, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9.5);
      pdf.text(getCompanyMonogram(profile.companyName), LEFT + 6.5, y + 8, {
        align: 'center',
      });
    }

    const leftTextX = LEFT + 16;
    const maxLeftW = WIDTH - 64;
    pdf.setTextColor(15, 23, 42);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11.5);
    const compLines = pdf.splitTextToSize(
      asciiSafe(profile.companyName).toUpperCase(),
      maxLeftW
    );
    pdf.text(compLines, leftTextX, y + 3.8);
    let leftY = y + 3.8 + compLines.length * 4.4;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.6);
    pdf.setTextColor(71, 85, 105);
    if (profile.registeredAddress) {
      const addrLines = pdf.splitTextToSize(
        asciiSafe(profile.registeredAddress),
        maxLeftW
      );
      pdf.text(addrLines.slice(0, 2), leftTextX, leftY);
      leftY += Math.min(2, addrLines.length) * 3.4;
    }

    const contactParts: string[] = [];
    if (profile.contactPhone)
      contactParts.push(`Tel: ${asciiSafe(profile.contactPhone)}`);
    if (profile.treasuryEmail)
      contactParts.push(`Email: ${asciiSafe(profile.treasuryEmail)}`);
    if (profile.pan) contactParts.push(`PAN: ${asciiSafe(profile.pan)}`);
    if (profile.gstin) contactParts.push(`GSTIN: ${asciiSafe(profile.gstin)}`);
    if (contactParts.length > 0) {
      pdf.text(fitText(pdf, contactParts.join(' | '), maxLeftW), leftTextX, leftY);
      leftY += 3.5;
    }

    // Right Statement Box
    const badgeW = 54;
    pdf.setFillColor(11, 25, 44);
    pdf.rect(RIGHT - badgeW, y, badgeW, 6.2, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text('CUSTOMER STATEMENT', RIGHT - badgeW / 2, y + 4.3, {
      align: 'center',
    });

    pdf.setTextColor(51, 65, 85);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.6);
    pdf.text(
      `Generated: ${formatIndianDate(todayIso)}`,
      RIGHT,
      y + 10.5,
      { align: 'right' }
    );
    pdf.text(
      fitText(pdf, `Customer Code: ${cust.customerCode || '-'}`, badgeW + 8),
      RIGHT,
      y + 14.3,
      { align: 'right' }
    );

    y = Math.max(y + 16, leftY + 2);
    pdf.setDrawColor(15, 23, 42);
    pdf.setLineWidth(0.5);
    pdf.line(LEFT, y, RIGHT, y);
    y += 5;
  };

  const ensureSpace = (needed: number, onNewPage?: () => void) => {
    if (y + needed > PAGE_BOTTOM) {
      pdf.addPage('a4', 'portrait');
      y = 14;
      drawTopLetterhead(true);
      onNewPage?.();
    }
  };

  const drawSectionHeading = (title: string) => {
    ensureSpace(14);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.8);
    pdf.setTextColor(11, 25, 44);
    pdf.text(asciiSafe(title).toUpperCase(), LEFT, y);
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.3);
    pdf.line(LEFT, y + 1.5, RIGHT, y + 1.5);
    y += 5.5;
  };

  drawTopLetterhead(false);

  // 1. CUSTOMER PROFILE SECTION
  drawSectionHeading('1. Customer Profile');
  const profileLines: [string, string][] = [
    ['Party / Customer Name:', cust.partyName || '-'],
    ['Customer Code:', cust.customerCode || '-'],
    ['Mobile / WhatsApp:', cust.mobileNumber || 'Not Recorded'],
    ['Contact Person:', cust.contactPerson || '-'],
    ['Email Address:', cust.email || '-'],
    ['Office / Billing Address:', cust.address || '-'],
  ];
  if (cust.pan || cust.gstin) {
    profileLines.push([
      'PAN / GSTIN:',
      [cust.pan ? `PAN: ${cust.pan}` : '', cust.gstin ? `GSTIN: ${cust.gstin}` : '']
        .filter(Boolean)
        .join(' | '),
    ]);
  }

  const profileBoxH = Math.ceil(profileLines.length / 2) * 5.6 + 4;
  pdf.setFillColor(248, 250, 252);
  pdf.setDrawColor(203, 213, 225);
  pdf.setLineWidth(0.25);
  pdf.rect(LEFT, y, WIDTH, profileBoxH, 'FD');

  const halfW = WIDTH / 2;
  profileLines.forEach(([label, val], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cellX = LEFT + 3 + col * halfW;
    const cellY = y + 4.8 + row * 5.6;

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.2);
    pdf.setTextColor(71, 85, 105);
    pdf.text(label, cellX, cellY);

    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(15, 23, 42);
    pdf.text(fitText(pdf, val, halfW - 39), cellX + 36, cellY);
  });
  y += profileBoxH + 6;

  // 2. LOAN SUMMARY SECTION
  drawSectionHeading('2. Loan & Account Summary');
  const ls = customer.loanSummary;
  const hasLoans = customer.schedules.length > 0;

  const kpis = hasLoans
    ? [
        {
          label: `Loan Principal (${ls.totalLoans} Loan${ls.totalLoans === 1 ? '' : 's'})`,
          value: formatINR(ls.totalPrincipal, true),
        },
        {
          label: 'Total Interest',
          value: formatINR(ls.totalInterest, true),
        },
        {
          label: 'Total Payable',
          value: formatINR(ls.totalPayable, true),
        },
        {
          label: `Paid (${ls.paidInstallments}/${ls.totalInstallments} Dues)`,
          value: formatINR(ls.paidAmount, true),
        },
        {
          label: 'Outstanding Balance',
          value: formatINR(ls.unpaidBalance, true),
        },
      ]
    : [
        {
          label: 'Total Cheques Logged',
          value: String(customer.cheques.length),
        },
        {
          label: 'Total Cheque Value',
          value: formatINR(customer.totalAmount, true),
        },
        {
          label: 'Returned Cheques',
          value: `${customer.returnedCount} (${formatINR(customer.returnedAmount, true)})`,
        },
        {
          label: 'Recovered Amount',
          value: formatINR(customer.recoveredAmount, true),
        },
      ];

  const kpiW = WIDTH / kpis.length;
  const kpiH = 14;
  kpis.forEach((k, idx) => {
    const kx = LEFT + idx * kpiW;
    const isLastHighlight = hasLoans && idx === kpis.length - 1;
    if (isLastHighlight) {
      pdf.setFillColor(11, 25, 44);
      pdf.setDrawColor(11, 25, 44);
    } else {
      pdf.setFillColor(255, 255, 255);
      pdf.setDrawColor(203, 213, 225);
    }
    pdf.rect(kx, y, kpiW, kpiH, 'FD');

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.6);
    pdf.setTextColor(
      isLastHighlight ? 203 : 100,
      isLastHighlight ? 213 : 116,
      isLastHighlight ? 225 : 139
    );
    pdf.text(fitText(pdf, k.label, kpiW - 4), kx + 2.2, y + 4.8);

    pdf.setFont('courier', 'bold');
    pdf.setFontSize(8);
    pdf.setTextColor(
      isLastHighlight ? 255 : 15,
      isLastHighlight ? 255 : 23,
      isLastHighlight ? 255 : 42
    );
    pdf.text(fitText(pdf, k.value, kpiW - 4), kx + 2.2, y + 10.6);
  });
  y += kpiH + 5;

  // Per-loan summary table
  if (hasLoans) {
    const loanCols = [
      { label: 'Loan / Ref No', x: LEFT, w: 30, align: 'left' as const },
      { label: 'Bank / Branch', x: LEFT + 30, w: 36, align: 'left' as const },
      { label: 'Scheme / Cycle', x: LEFT + 66, w: 34, align: 'left' as const },
      { label: 'Principal (Rs.)', x: LEFT + 100, w: 22, align: 'right' as const },
      { label: 'Payable (Rs.)', x: LEFT + 122, w: 22, align: 'right' as const },
      { label: 'Paid (Rs.)', x: LEFT + 144, w: 21, align: 'right' as const },
      { label: 'Balance (Rs.)', x: LEFT + 165, w: 21, align: 'right' as const },
    ];

    const drawLoanSummaryHeader = () => {
      const hh = 6.8;
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(148, 163, 184);
      pdf.rect(LEFT, y, WIDTH, hh, 'FD');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.8);
      pdf.setTextColor(15, 23, 42);
      for (const c of loanCols) {
        if (c.x > LEFT) pdf.line(c.x, y, c.x, y + hh);
        if (c.align === 'right') {
          pdf.text(c.label, c.x + c.w - 1.5, y + 4.5, { align: 'right' });
        } else {
          pdf.text(c.label, c.x + 1.5, y + 4.5);
        }
      }
      y += hh;
    };

    ensureSpace(15);
    drawLoanSummaryHeader();

    for (const sch of customer.schedules) {
      const t = getScheduleTotals(sch, chequeById);
      const rowH = 7.5;
      ensureSpace(rowH, drawLoanSummaryHeader);
      pdf.setDrawColor(203, 213, 225);
      pdf.rect(LEFT, y, WIDTH, rowH, 'S');
      for (const c of loanCols) {
        if (c.x > LEFT) pdf.line(c.x, y, c.x, y + rowH);
      }

      pdf.setFont('courier', 'bold');
      pdf.setFontSize(6.9);
      pdf.setTextColor(15, 23, 42);
      pdf.text(fitText(pdf, sch.loanRefNo || sch.id.slice(-8), 27), LEFT + 1.5, y + 4.8);

      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.7);
      pdf.text(
        fitText(
          pdf,
          `${sch.draweeBank || 'Bank'}${sch.draweeBranch ? ` (${sch.draweeBranch})` : ''}`,
          33
        ),
        LEFT + 31.5,
        y + 4.8
      );

      const schemeTxt = `${getFrequencyLabel(sch.frequency)} | ${getInterestTypeLabel(sch.interestType)}${
        sch.interestType !== 'ZERO_INTEREST' ? ` ${sch.interestRate ?? 0}%` : ''
      }`;
      pdf.text(fitText(pdf, schemeTxt, 31), LEFT + 67.5, y + 4.8);

      pdf.setFont('courier', 'normal');
      pdf.text(formatINR(t.principal, false), LEFT + 120.5, y + 4.8, { align: 'right' });
      pdf.text(formatINR(t.totalPayable, false), LEFT + 142.5, y + 4.8, { align: 'right' });
      pdf.setTextColor(4, 120, 87);
      pdf.text(formatINR(t.paidAmount, false), LEFT + 163.5, y + 4.8, { align: 'right' });
      pdf.setFont('courier', 'bold');
      pdf.setTextColor(t.balance > 0 ? 180 : 15, t.balance > 0 ? 83 : 23, t.balance > 0 ? 9 : 42);
      pdf.text(formatINR(t.balance, false), LEFT + 184.5, y + 4.8, { align: 'right' });

      y += rowH;
    }
    y += 6;
  }

  // 3. FULL INSTALLMENT PAYMENT HISTORY
  drawSectionHeading('3. Full Installment Payment History');

  if (!hasLoans) {
    ensureSpace(10);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      'No loan / installment schedule records exist for this customer.',
      LEFT,
      y + 3
    );
    y += 9;
  } else {
    const instCols = [
      { label: 'Inst #', x: LEFT, w: 12, align: 'center' as const },
      { label: 'Due Date', x: LEFT + 12, w: 22, align: 'left' as const },
      { label: 'Deposit Date', x: LEFT + 34, w: 22, align: 'left' as const },
      { label: 'Cheque No', x: LEFT + 56, w: 21, align: 'left' as const },
      { label: 'Principal (Rs.)', x: LEFT + 77, w: 24, align: 'right' as const },
      { label: 'Interest (Rs.)', x: LEFT + 101, w: 21, align: 'right' as const },
      { label: 'Due Amt (Rs.)', x: LEFT + 122, w: 23, align: 'right' as const },
      { label: 'Paid Status', x: LEFT + 145, w: 20, align: 'left' as const },
      { label: 'Balance (Rs.)', x: LEFT + 165, w: 21, align: 'right' as const },
    ];

    for (const sch of customer.schedules) {
      const totals = getScheduleTotals(sch, chequeById);
      const rowsWithBalance = computeScheduleRowsWithBalance(sch.cheques || []);

      const drawInstTableHeader = () => {
        const hh = 6.8;
        pdf.setFillColor(241, 245, 249);
        pdf.setDrawColor(148, 163, 184);
        pdf.rect(LEFT, y, WIDTH, hh, 'FD');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.4);
        pdf.setTextColor(15, 23, 42);
        for (const c of instCols) {
          if (c.x > LEFT) pdf.line(c.x, y, c.x, y + hh);
          if (c.align === 'center') {
            pdf.text(c.label, c.x + c.w / 2, y + 4.5, { align: 'center' });
          } else if (c.align === 'right') {
            pdf.text(c.label, c.x + c.w - 1.5, y + 4.5, { align: 'right' });
          } else {
            pdf.text(c.label, c.x + 1.2, y + 4.5);
          }
        }
        y += hh;
      };

      ensureSpace(22);

      // Loan Banner
      pdf.setFillColor(11, 25, 44);
      pdf.rect(LEFT, y, WIDTH, 10.5, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(255, 255, 255);
      pdf.text(
        fitText(
          pdf,
          `Loan Ref: ${sch.loanRefNo || 'N/A'}  |  ${sch.draweeBank || 'Bank'}${sch.draweeBranch ? ` - ${sch.draweeBranch}` : ''}`,
          122
        ),
        LEFT + 2.5,
        y + 4.3
      );
      pdf.setFont('courier', 'bold');
      pdf.setFontSize(7.2);
      pdf.text(
        asciiSafe(
          `${totals.paidCount}/${rowsWithBalance.length} Paid | Bal: ${formatINR(totals.balance, true)}`
        ),
        RIGHT - 2.5,
        y + 4.3,
        { align: 'right' }
      );
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6.6);
      pdf.setTextColor(203, 213, 225);
      pdf.text(
        fitText(
          pdf,
          `Cycle: ${getFrequencyLabel(sch.frequency)} | Rate: ${getInterestTypeLabel(sch.interestType)} ${
            sch.interestType !== 'ZERO_INTEREST' ? `(${sch.interestRate ?? 0}%)` : ''
          } | Principal: ${formatINR(totals.principal, true)} | Total Payable: ${formatINR(totals.totalPayable, true)}`,
          WIDTH - 5
        ),
        LEFT + 2.5,
        y + 8.6
      );
      y += 10.5;

      drawInstTableHeader();

      rowsWithBalance.forEach(({ item, runningBalance }, idx) => {
        const paidInfo = resolveInstallmentPaidInfo(item, chequeById);
        const rowH = 6.8;
        ensureSpace(rowH, drawInstTableHeader);

        if (idx % 2 === 1) {
          pdf.setFillColor(248, 250, 252);
          pdf.rect(LEFT, y, WIDTH, rowH, 'FD');
        } else {
          pdf.setDrawColor(203, 213, 225);
          pdf.rect(LEFT, y, WIDTH, rowH, 'S');
        }
        pdf.setDrawColor(203, 213, 225);
        for (const c of instCols) {
          if (c.x > LEFT) pdf.line(c.x, y, c.x, y + rowH);
        }

        pdf.setFont('courier', 'normal');
        pdf.setFontSize(6.8);
        pdf.setTextColor(71, 85, 105);
        pdf.text(String(item.dueNumber ?? idx + 1), LEFT + 6, y + 4.5, {
          align: 'center',
        });

        pdf.text(formatIndianDate(item.originalDate), LEFT + 13.2, y + 4.5);
        pdf.setTextColor(15, 23, 42);
        pdf.text(formatIndianDate(item.effectiveDate), LEFT + 35.2, y + 4.5);

        pdf.setFont('courier', 'bold');
        pdf.text(fitText(pdf, item.chequeNumber || '-', 19), LEFT + 57.2, y + 4.5);

        pdf.setFont('courier', 'normal');
        pdf.text(
          formatINR(item.principalAmount ?? item.amount, false),
          LEFT + 99.5,
          y + 4.5,
          { align: 'right' }
        );
        pdf.text(
          formatINR(item.interestAmount ?? 0, false),
          LEFT + 120.5,
          y + 4.5,
          { align: 'right' }
        );
        pdf.setFont('courier', 'bold');
        pdf.text(formatINR(item.amount, false), LEFT + 143.5, y + 4.5, {
          align: 'right',
        });

        // Paid Status
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(6.3);
        if (paidInfo.isPaid) {
          pdf.setTextColor(4, 120, 87);
        } else if (paidInfo.effectiveStatus === 'Returned / Bounced') {
          pdf.setTextColor(185, 28, 28);
        } else if (paidInfo.effectiveStatus === 'In Clearing') {
          pdf.setTextColor(29, 78, 216);
        } else {
          pdf.setTextColor(100, 116, 139);
        }
        const statusShort = paidInfo.isPaid
          ? 'PAID'
          : paidInfo.effectiveStatus === 'Returned / Bounced'
          ? 'BOUNCED'
          : paidInfo.effectiveStatus === 'In Clearing'
          ? 'CLEARING'
          : 'UNPAID';
        pdf.text(statusShort, LEFT + 146.5, y + 4.5);

        // Balance
        pdf.setFont('courier', 'normal');
        pdf.setFontSize(6.8);
        pdf.setTextColor(15, 23, 42);
        pdf.text(
          formatINR(item.balance ?? runningBalance, false),
          LEFT + 184.5,
          y + 4.5,
          { align: 'right' }
        );

        y += rowH;
      });

      // Totals footer row for this loan
      ensureSpace(8);
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(148, 163, 184);
      pdf.rect(LEFT, y, WIDTH, 7.2, 'FD');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.9);
      pdf.setTextColor(15, 23, 42);
      pdf.text(
        asciiSafe(
          `Totals - Payable: ${formatINR(totals.totalPayable, true)}   |   Paid: ${formatINR(totals.paidAmount, true)}   |   Remaining Loan Balance: ${formatINR(totals.balance, true)}`
        ),
        RIGHT - 2.5,
        y + 4.8,
        { align: 'right' }
      );
      y += 11;
    }
  }

  // 4. CLEARING CHEQUE & RECOVERY LEDGER (for standalone/all logged cheques of this customer)
  if (customer.cheques.length > 0) {
    drawSectionHeading('4. Cheque Clearing & Recovery Ledger');
    const chqCols = [
      { label: 'Chq Date', x: LEFT, w: 22, align: 'left' as const },
      { label: 'Cheque #', x: LEFT + 22, w: 21, align: 'left' as const },
      { label: 'Batch Ref', x: LEFT + 43, w: 32, align: 'left' as const },
      { label: 'Drawee Bank', x: LEFT + 75, w: 40, align: 'left' as const },
      { label: 'Amount (Rs.)', x: LEFT + 115, w: 26, align: 'right' as const },
      { label: 'Status / Remarks', x: LEFT + 141, w: 45, align: 'left' as const },
    ];

    const drawChqHeader = () => {
      const hh = 6.8;
      pdf.setFillColor(241, 245, 249);
      pdf.setDrawColor(148, 163, 184);
      pdf.rect(LEFT, y, WIDTH, hh, 'FD');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.6);
      pdf.setTextColor(15, 23, 42);
      for (const c of chqCols) {
        if (c.x > LEFT) pdf.line(c.x, y, c.x, y + hh);
        if (c.align === 'right') {
          pdf.text(c.label, c.x + c.w - 1.5, y + 4.5, { align: 'right' });
        } else {
          pdf.text(c.label, c.x + 1.5, y + 4.5);
        }
      }
      y += hh;
    };

    ensureSpace(15);
    drawChqHeader();

    for (const chq of customer.cheques) {
      const batch = batchById.get(chq.batchId);
      const statusText = chq.bounceReason
        ? `${chq.status} (${chq.bounceReason})`
        : chq.clearedDate
        ? `${chq.status} (${formatIndianDate(chq.clearedDate)})`
        : chq.status;
      const rowH = 7.2;
      ensureSpace(rowH, drawChqHeader);

      pdf.setDrawColor(203, 213, 225);
      pdf.rect(LEFT, y, WIDTH, rowH, 'S');
      for (const c of chqCols) {
        if (c.x > LEFT) pdf.line(c.x, y, c.x, y + rowH);
      }

      pdf.setFont('courier', 'normal');
      pdf.setFontSize(6.8);
      pdf.setTextColor(15, 23, 42);
      pdf.text(formatIndianDate(chq.chequeDate), LEFT + 1.5, y + 4.7);
      pdf.setFont('courier', 'bold');
      pdf.text(fitText(pdf, `#${chq.chequeNumber}`, 19), LEFT + 23.5, y + 4.7);
      pdf.setFont('courier', 'normal');
      pdf.text(fitText(pdf, batch?.batchRef || '-', 29), LEFT + 44.5, y + 4.7);
      pdf.setFont('helvetica', 'normal');
      pdf.text(fitText(pdf, chq.draweeBank || '-', 37), LEFT + 76.5, y + 4.7);
      pdf.setFont('courier', 'bold');
      pdf.text(formatINR(chq.amount, false), LEFT + 139.5, y + 4.7, { align: 'right' });
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      if (chq.status === 'Cleared' || chq.status === 'Settled / Recovered') {
        pdf.setTextColor(4, 120, 87);
      } else if (chq.status === 'Returned / Bounced') {
        pdf.setTextColor(185, 28, 28);
      } else {
        pdf.setTextColor(51, 65, 85);
      }
      pdf.text(fitText(pdf, statusText, 42), LEFT + 142.5, y + 4.7);

      y += rowH;
    }
    y += 6;
  }

  // Footer with total pages on every page
  const totalPages = pdf.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    pdf.setPage(p);
    pdf.setDrawColor(203, 213, 225);
    pdf.setLineWidth(0.25);
    pdf.line(LEFT, 283, RIGHT, 283);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7);
    pdf.setTextColor(100, 116, 139);
    pdf.text(
      fitText(
        pdf,
        `${profile.companyName} | Customer Statement: ${cust.partyName}`,
        140
      ),
      LEFT,
      287.5
    );
    pdf.text(`Page ${p} of ${totalPages}`, RIGHT, 287.5, { align: 'right' });
  }

  const cleanCustomerName = asciiSafe(cust.partyName || 'Customer')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  const filename = `Customer_Statement_${cleanCustomerName || 'Account'}_${todayIso}.pdf`;
  const blob = pdf.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  pdf.save(filename);

  return { filename, blobUrl };
}
