import PDFDocument from 'pdfkit';
import { PayeeSnapshot } from './checks.types';

/** Tek bir cekin PDF verisi. */
export interface CheckDoc {
  checkNumber: number;
  amountCents: bigint;
  payee: PayeeSnapshot;
  memo: string;
  dateLabel: string; // "June 18, 2026"
}

export interface ChecksPdfData {
  companyName: string;
  checks: CheckDoc[];
  generatedLabel: string;
}

// --- tutar -> yazi (ABD ceki: "One Thousand Two Hundred Thirty-Four and 56/100") ---
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function threeDigits(n: number): string {
  let s = '';
  if (n >= 100) { s += `${ONES[Math.floor(n / 100)]} Hundred`; n %= 100; if (n) s += ' '; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += `-${ONES[n % 10]}`; }
  else if (n > 0) s += ONES[n];
  return s;
}

function intToWords(n: number): string {
  if (n === 0) return 'Zero';
  const groups = ['', 'Thousand', 'Million', 'Billion'];
  let g = 0;
  let out = '';
  while (n > 0) {
    const chunk = n % 1000;
    if (chunk) {
      const part = threeDigits(chunk) + (groups[g] ? ` ${groups[g]}` : '');
      out = part + (out ? ` ${out}` : '');
    }
    n = Math.floor(n / 1000);
    g++;
  }
  return out;
}

export function centsToWords(cents: bigint): string {
  const dollars = Number(cents / 100n);
  const c = Number(cents % 100n);
  return `${intToWords(dollars)} and ${c.toString().padStart(2, '0')}/100`;
}

export function formatUsd(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const dollars = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const c = (abs % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}$${dollars}.${c}`;
}

/**
 * Cek-run PDF'i: her sayfada bir cek (ceki + adres + makbuz koc'ani), sonda cek register ozeti.
 * pdfkit'in gomulu Helvetica fontu kullanilir (harici font dosyasi yok). Buffer doner.
 *
 * NOT: bu gercek bir MICR-kodlu banka ceki DEGIL — admin bunu cek kagidina basar/postalar.
 * Veri (tutar/payee/no) dogru; fiziksel cek bicimi tenant'in cek stoguna gore ayarlanabilir.
 */
export function buildChecksPdf(data: ChecksPdfData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const L = 50; // sol kenar
    const R = 562; // sag kenar (612 - 50)

    data.checks.forEach((chk, i) => {
      if (i > 0) doc.addPage();
      drawCheck(doc, data.companyName, chk, L, R);
    });

    // --- Cek register (ozet) ---
    doc.addPage();
    doc.font('Helvetica-Bold').fontSize(16).text('Check Register', L, 60);
    doc.font('Helvetica').fontSize(10).fillColor('#555')
      .text(`${data.companyName} · generated ${data.generatedLabel}`, L, 84);
    doc.fillColor('#000');

    let y = 120;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Check #', L, y);
    doc.text('Payee', L + 70, y);
    doc.text('Memo', L + 270, y);
    doc.text('Amount', R - 90, y, { width: 90, align: 'right' });
    y += 6;
    doc.moveTo(L, y + 8).lineTo(R, y + 8).strokeColor('#999').stroke();
    y += 16;

    doc.font('Helvetica').fontSize(10);
    let total = 0n;
    for (const chk of data.checks) {
      total += chk.amountCents;
      doc.text(String(chk.checkNumber), L, y);
      doc.text(chk.payee.name, L + 70, y, { width: 195, ellipsis: true });
      doc.text(chk.memo, L + 270, y, { width: R - 90 - (L + 270) - 6, ellipsis: true });
      doc.text(formatUsd(chk.amountCents), R - 90, y, { width: 90, align: 'right' });
      y += 16;
      if (y > 720) { doc.addPage(); y = 60; }
    }
    doc.moveTo(L, y + 2).lineTo(R, y + 2).strokeColor('#999').stroke();
    y += 10;
    doc.font('Helvetica-Bold').fontSize(11);
    doc.text(`Total — ${data.checks.length} check${data.checks.length === 1 ? '' : 's'}`, L, y);
    doc.text(formatUsd(total), R - 110, y, { width: 110, align: 'right' });

    doc.end();
  });
}

function drawCheck(doc: PDFKit.PDFDocument, company: string, chk: CheckDoc, L: number, R: number): void {
  const top = 60;
  // cek cercevesi
  doc.roundedRect(L, top, R - L, 230, 6).strokeColor('#cccccc').lineWidth(1).stroke();

  // sirket (sol ust) + cek no (sag ust). width+ellipsis: asiri uzun tenant adi layout'u bozmasin/tasmasin.
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(14).text(company, L + 18, top + 16, { width: R - L - 210, ellipsis: true, lineBreak: false });
  doc.font('Helvetica').fontSize(9).fillColor('#666').text('Commission Disbursement', L + 18, top + 34);
  doc.font('Helvetica-Bold').fontSize(12).fillColor('#000')
    .text(`Check No. ${chk.checkNumber}`, R - 180, top + 16, { width: 162, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor('#333')
    .text(`Date: ${chk.dateLabel}`, R - 180, top + 34, { width: 162, align: 'right' });

  // PAY TO THE ORDER OF + tutar kutusu
  const payY = top + 74;
  doc.font('Helvetica').fontSize(8).fillColor('#666').text('PAY TO THE ORDER OF', L + 18, payY);
  doc.font('Helvetica-Bold').fontSize(14).fillColor('#000').text(chk.payee.name, L + 18, payY + 12, { width: R - L - 200 });
  // tutar kutusu (sag)
  doc.roundedRect(R - 150, payY + 4, 132, 26, 3).strokeColor('#000').lineWidth(1).stroke();
  doc.font('Helvetica-Bold').fontSize(14).text(formatUsd(chk.amountCents), R - 146, payY + 11, { width: 124, align: 'right' });

  // tutar yaziyla (dolgu ****)
  const wordsY = payY + 44;
  const words = `${centsToWords(chk.amountCents)} `;
  doc.font('Helvetica').fontSize(11).fillColor('#000').text(words, L + 18, wordsY, { width: R - L - 36, continued: false });
  doc.moveTo(L + 18, wordsY + 16).lineTo(R - 18, wordsY + 16).strokeColor('#999').lineWidth(0.5).stroke();
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#999').text('DOLLARS', R - 70, wordsY + 18);

  // payee adresi (sol alt — pencereli zarf icin)
  const addrY = top + 150;
  doc.font('Helvetica').fontSize(9).fillColor('#444');
  const addr = [
    chk.payee.name,
    chk.payee.line1,
    chk.payee.line2 || null,
    `${chk.payee.city}, ${chk.payee.state} ${chk.payee.postal}`,
  ].filter(Boolean) as string[];
  doc.text(addr.join('\n'), L + 18, addrY, { width: 260, lineGap: 1 });

  // memo + imza
  doc.font('Helvetica').fontSize(9).fillColor('#666').text(`MEMO: ${chk.memo}`, L + 18, top + 208);
  doc.moveTo(R - 200, top + 206).lineTo(R - 18, top + 206).strokeColor('#000').lineWidth(0.5).stroke();
  doc.font('Helvetica').fontSize(8).fillColor('#666').text('AUTHORIZED SIGNATURE', R - 200, top + 210, { width: 182, align: 'center' });

  // alt not
  doc.font('Helvetica-Oblique').fontSize(7).fillColor('#aaa')
    .text('Printed by Refearn — print on check stock. Not a MICR-encoded bank instrument.', L, top + 244, { width: R - L, align: 'center' });
  doc.fillColor('#000');
}
