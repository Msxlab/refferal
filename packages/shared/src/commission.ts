import { bpsAmount } from './money';

export interface PlanLevelRate {
  level: number;
  rateBps: number;
}

export interface CommissionLine {
  level: number;
  beneficiaryMembershipId: string;
  rateBpsUsed: number;
  amountCents: bigint;
}

/**
 * Motorun saf cekirdegi (SPEC 7, adim 4): kayan pencere dagitimi.
 *
 * uplineChain[0] = satici, uplineChain[i] = i. ust sponsor (en fazla plan derinligi kadar).
 * - Zincirde olmayan seviyeye satir YAZILMAZ — pay sirkette kalir (SPEC 3.3).
 * - Tutar floor(amount * rate / 10000); 0-cent sonuc icin de satir yazilmaz (docs/DECISIONS.md).
 * - Pasif uye/compression karari engine'de zincir bu fonksiyona gelmeden once verilir.
 *   Bu fonksiyon yalnizca kendisine verilen pencereyi dagitir.
 *
 * Bu fonksiyon DB'den tamamen bagimsizdir: plan simulatoru (POST /admin/plans/simulate)
 * ve landing'deki interaktif demo da ayni fonksiyonu kullanir.
 */
export function computeCommissionLines(
  amountCents: bigint,
  levels: PlanLevelRate[],
  uplineChain: readonly string[],
): CommissionLine[] {
  const lines: CommissionLine[] = [];
  const sorted = [...levels].sort((a, b) => a.level - b.level);

  for (const { level, rateBps } of sorted) {
    const beneficiary = uplineChain[level];
    if (!beneficiary) continue; // eksik upline: pay dagitilmaz, sirkette kalir

    const amount = bpsAmount(amountCents, rateBps);
    if (amount <= 0n) continue; // 0-cent satir yazilmaz

    lines.push({ level, beneficiaryMembershipId: beneficiary, rateBpsUsed: rateBps, amountCents: amount });
  }

  return lines;
}

/** Bir satisin dagitilan toplami — invariant kontrolu icin: toplam <= amount * pool_rate */
export function totalDistributed(lines: CommissionLine[]): bigint {
  return lines.reduce((acc, l) => acc + l.amountCents, 0n);
}
