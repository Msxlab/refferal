/**
 * NACHA ACH (PPD credit) dosya ureticisi — SELF-HOSTED banka odeme dosyasi.
 * Dis servis YOK: admin bu dosyayi kendi bankasinin portaline yukler, banka transferi yapar.
 * 94 karakterlik kayitlar, 10'luk bloklar (9-dolgu). Spec: NACHA Operating Rules (PPD).
 *
 * ODFI/sirket bilgileri env'den; gercek banka kabulu icin admin dogru degerleri girmeli.
 */
export interface AchEntry {
  routingNumber: string; // 9 hane (alici DFI)
  accountNumber: string; // tam hesap (decrypt edilmis)
  accountType: 'checking' | 'savings';
  amountCents: number;
  name: string;
  id: string; // bireysel kimlik (membership id kisa)
}

export interface AchConfig {
  odfiRouting: string; // originating DFI routing (9 hane)
  companyName: string;
  companyId: string; // 10 hane (genelde 1 + EIN)
  destRouting: string; // immediate destination routing (9 hane)
  entryDescription?: string;
}

const pr = (s: string, n: number) => (s + ' '.repeat(n)).slice(0, n); // sola dayali
const pn = (v: number | string, n: number) => String(v).replace(/\D/g, '').padStart(n, '0').slice(-n); // sayisal, sifir-dolgu

export function buildNachaFile(entries: AchEntry[], cfg: AchConfig, now: Date): string {
  const yymmdd = (d: Date) => `${String(d.getUTCFullYear()).slice(2)}${pn(d.getUTCMonth() + 1, 2)}${pn(d.getUTCDate(), 2)}`;
  const hhmm = (d: Date) => `${pn(d.getUTCHours(), 2)}${pn(d.getUTCMinutes(), 2)}`;
  const odfi8 = pn(cfg.odfiRouting, 9).slice(0, 8);
  const lines: string[] = [];

  // 1 — File Header
  lines.push(
    '1' + '01' +
    ' ' + pn(cfg.destRouting, 9) +
    pn(cfg.odfiRouting, 10) +
    yymmdd(now) + hhmm(now) + 'A' + '094' + '10' + '1' +
    pr('', 23) + pr(cfg.companyName.toUpperCase(), 23) + pr('', 8),
  );
  // 5 — Batch Header (PPD, credits)
  lines.push(
    '5' + '220' +
    pr(cfg.companyName.toUpperCase(), 16) + pr('', 20) +
    pr(cfg.companyId, 10) + 'PPD' +
    pr((cfg.entryDescription ?? 'PAYOUT').toUpperCase(), 10) +
    yymmdd(now) + yymmdd(now) + '   ' + '1' + odfi8 + pn(1, 7),
  );

  // 6 — Entry Detail
  let hash = 0;
  let totalCredit = 0;
  entries.forEach((e, i) => {
    const recv = pn(e.routingNumber, 9);
    const recv8 = recv.slice(0, 8);
    const checkDigit = recv.slice(8, 9);
    hash += Number(recv8);
    totalCredit += e.amountCents;
    const txCode = e.accountType === 'savings' ? '32' : '22'; // savings/checking credit
    lines.push(
      '6' + txCode + recv8 + checkDigit +
      pr(e.accountNumber, 17) + pn(e.amountCents, 10) +
      pr(e.id.replace(/-/g, '').slice(0, 15), 15) + pr(e.name.toUpperCase(), 22) +
      '  ' + '0' + odfi8 + pn(i + 1, 7),
    );
  });

  const entryCount = entries.length;
  const hashStr = pn(hash % 10_000_000_000, 10);

  // 8 — Batch Control
  lines.push(
    '8' + '220' + pn(entryCount, 6) + hashStr +
    pn(0, 12) + pn(totalCredit, 12) +
    pr(cfg.companyId, 10) + pr('', 19) + pr('', 6) + odfi8 + pn(1, 7),
  );
  // 9 — File Control
  const blockCount = Math.ceil((lines.length + 1) / 10);
  lines.push(
    '9' + pn(1, 6) + pn(blockCount, 6) + pn(entryCount, 8) + hashStr +
    pn(0, 12) + pn(totalCredit, 12) + pr('', 39),
  );

  // 9-dolgu: toplam satir 10'un kati olana dek
  while (lines.length % 10 !== 0) lines.push('9'.repeat(94));

  return lines.join('\n') + '\n';
}

export function achConfigFromEnv(companyNameFallback: string): AchConfig {
  return {
    odfiRouting: process.env.REFEARN_ACH_ODFI_ROUTING ?? '000000000',
    destRouting: process.env.REFEARN_ACH_DEST_ROUTING ?? process.env.REFEARN_ACH_ODFI_ROUTING ?? '000000000',
    companyId: process.env.REFEARN_ACH_COMPANY_ID ?? '0000000000',
    companyName: process.env.REFEARN_ACH_COMPANY_NAME ?? companyNameFallback,
    entryDescription: 'PAYOUT',
  };
}
