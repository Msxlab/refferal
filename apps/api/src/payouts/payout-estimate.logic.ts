/**
 * Tahmini odeme tarihi — saf cekirdek (DB yok, NestJS yok). Birim test edilir.
 * "Esik-asim tarihi": birikmis payable + maturesAt'e gore olgunlasacak pending'in
 * tenant.payoutMinCents'e ilk ulastigi gun. Zaten esik ustundeyse bir sonraki
 * auto-request ani; hic ulasilamiyorsa null.
 */

export interface PendingPiece {
  amountCents: bigint;
  maturesAt: Date; // cagiran yalniz maturesAt != null pending satirlari verir
}

export interface EstimateInput {
  payableCents: bigint;
  payoutMinCents: bigint;
  pending: PendingPiece[];
  now: Date;
  timezone: string; // IANA, orn 'America/New_York'
}

/** Bir an'in verilen IANA timezone'daki duvar-saati parcalari. */
function wallClockParts(date: Date, timeZone: string): { y: number; mo: number; d: number; h: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const part of dtf.formatToParts(date)) p[part.type] = part.value;
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) };
}

/** tenant tz'de (y,mo,d) gununun 06:00'inin UTC instant'i (06:00 DST gecis saati degil → tek duzeltme yeterli). */
function zonedSixAmUtc(y: number, mo: number, d: number, timeZone: string): Date {
  let ms = Date.UTC(y, mo - 1, d, 6, 0, 0);
  const seen = wallClockParts(new Date(ms), timeZone);
  const seenMs = Date.UTC(seen.y, seen.mo - 1, seen.d, seen.h, 0, 0);
  const offset = seenMs - ms; // tz duvar-saati UTC'den ne kadar ileri
  ms -= offset;
  return new Date(ms);
}

/** auto-request gece job'u tenant tz'de 06:00'da calisir: simdiden sonraki 06:00 instant'i. */
export function nextAutoRequestAt(now: Date, timeZone: string): Date {
  const today = wallClockParts(now, timeZone);
  let six = zonedSixAmUtc(today.y, today.mo, today.d, timeZone);
  if (six.getTime() <= now.getTime()) {
    const t = wallClockParts(new Date(now.getTime() + 24 * 3_600_000), timeZone);
    six = zonedSixAmUtc(t.y, t.mo, t.d, timeZone);
  }
  return six;
}

/** Esik-asim tarihini hesaplar. Bkz. dosya basligi. */
export function computeEstimateDate(input: EstimateInput): Date | null {
  const { payableCents, payoutMinCents, pending, now, timezone } = input;
  if (payableCents >= payoutMinCents) return nextAutoRequestAt(now, timezone);

  const shortfall = payoutMinCents - payableCents; // > 0
  const sorted = [...pending].sort((a, b) => a.maturesAt.getTime() - b.maturesAt.getTime());
  let cum = 0n;
  for (const piece of sorted) {
    cum += piece.amountCents;
    if (cum >= shortfall) return piece.maturesAt;
  }
  return null;
}
