import {
  bpsAmount,
  centsToDecimalString,
  commissionPlanSchema,
  computeCommissionLines,
  totalDistributed,
  DEFAULT_LEVEL_RATES_BPS,
  DEFAULT_POOL_RATE_BPS,
} from '../src';

const PLAN = DEFAULT_LEVEL_RATES_BPS.map((rateBps, level) => ({ level, rateBps }));
const chain = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe('para yardimcilari (SPEC 3.5)', () => {
  it('bpsAmount floor uygular', () => {
    expect(bpsAmount(999n, 500)).toBe(49n); // 49.95 -> 49
    expect(bpsAmount(10_000n, 1)).toBe(1n);
    expect(bpsAmount(9_999n, 1)).toBe(0n);
    expect(bpsAmount(0n, 500)).toBe(0n);
  });

  it('negatif tutar ve gecersiz oran reddedilir', () => {
    expect(() => bpsAmount(-1n, 500)).toThrow(RangeError);
    expect(() => bpsAmount(100n, -1)).toThrow(RangeError);
    expect(() => bpsAmount(100n, 10_001)).toThrow(RangeError);
    expect(() => bpsAmount(100n, 5.5)).toThrow(RangeError);
  });

  it('centsToDecimalString isaret ve pad dogru', () => {
    expect(centsToDecimalString(123456n)).toBe('1234.56');
    expect(centsToDecimalString(-50n)).toBe('-0.50');
    expect(centsToDecimalString(0n)).toBe('0.00');
  });
});

describe('plan dogrulamasi (SPEC 3.2)', () => {
  const valid = {
    name: 'Standart',
    poolRateBps: DEFAULT_POOL_RATE_BPS,
    depth: 5,
    levels: PLAN,
  };

  it('Axtra standart plani gecerli', () => {
    expect(commissionPlanSchema.safeParse(valid).success).toBe(true);
  });

  it('SUM(level_rates) > pool_rate reddedilir', () => {
    const levels = [{ level: 0, rateBps: 900 }, { level: 1, rateBps: 200 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 2, levels }).success).toBe(false);
  });

  it('level 0 (satici) zorunlu', () => {
    const levels = [{ level: 1, rateBps: 100 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 1, levels }).success).toBe(false);
  });

  it('level boslugu / tekrari reddedilir', () => {
    const gap = [{ level: 0, rateBps: 100 }, { level: 2, rateBps: 100 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 3, levels: gap }).success).toBe(false);

    const dup = [{ level: 0, rateBps: 100 }, { level: 0, rateBps: 100 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 2, levels: dup }).success).toBe(false);
  });

  it('negatif oran reddedilir', () => {
    const levels = [{ level: 0, rateBps: -1 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 1, levels }).success).toBe(false);
  });
});

describe('computeCommissionLines — saf cekirdek (SPEC 11)', () => {
  it('T1: $100.000 satis, 4+ ust → 5000/2000/1500/1000/500 = $10.000', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(5));
    expect(lines.map((l) => l.amountCents)).toEqual([500_000n, 200_000n, 150_000n, 100_000n, 50_000n]);
    expect(lines.map((l) => l.beneficiaryMembershipId)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(totalDistributed(lines)).toBe(1_000_000n);
  });

  it('T2: kurucu satar (0 ust) → sadece satici $5.000, baska satir yok', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 0, beneficiaryMembershipId: 'm0', amountCents: 500_000n });
    expect(totalDistributed(lines)).toBe(500_000n); // kalan $5.000 dagitilmaz
  });

  it('T3: yalniz 2 ust → L0/L1/L2 yazilir, L3/L4 satiri yok', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(3));
    expect(lines.map((l) => l.level)).toEqual([0, 1, 2]);
    expect(lines.map((l) => l.amountCents)).toEqual([500_000n, 200_000n, 150_000n]);
  });

  it('T8: adalet — ozdes alt-yapiya sahip L1 ve L7 uyesi birebir esit kazanir', () => {
    // Govde: m0 (kok) -> m1 -> ... -> m6. A = m1 (derinlik 1), B = m6 (derinlik 6 / "L7").
    const trunk = chain(7);
    const upline = (idx: number) => trunk.slice(0, idx + 1).reverse(); // [kendi, sponsor, ...]

    const earningsWithDownline = (member: string, memberUpline: string[]) => {
      // ozdes alt-yapi: uyenin altinda 4 kisilik zincir, herkes $10.000 satar
      const downline = [member, ...Array.from({ length: 4 }, (_, i) => `${member}-d${i + 1}`)];
      let total = 0n;
      for (let i = 0; i < downline.length; i++) {
        const sellerChain = [...downline.slice(0, i + 1).reverse(), ...memberUpline.slice(1)];
        const lines = computeCommissionLines(1_000_000n, PLAN, sellerChain);
        total += lines.filter((l) => l.beneficiaryMembershipId === member).reduce((a, l) => a + l.amountCents, 0n);
      }
      return total;
    };

    const a = earningsWithDownline('m1', upline(1));
    const b = earningsWithDownline('m6', upline(6));
    expect(a).toBe(b);
    expect(a).toBe(100_000n); // $10.000 x (500+200+150+100+50 bps) = $1.000
  });

  it('T9: $33.333 satis — her seviye floor, toplam ≤ %10, fark sirkette', () => {
    const amount = 3_333_300n; // $33.333,00
    const lines = computeCommissionLines(amount, PLAN, chain(5));
    expect(lines.map((l) => l.amountCents)).toEqual([166_665n, 66_666n, 49_999n, 33_333n, 16_666n]);

    const pool = bpsAmount(amount, DEFAULT_POOL_RATE_BPS); // 333.330
    expect(totalDistributed(lines)).toBe(333_329n);
    expect(totalDistributed(lines) <= pool).toBe(true); // 1 cent sirkette kalir
  });

  it('invariant: rastgele tutarlarda toplam asla havuzu asmaz', () => {
    const amounts = [1n, 7n, 99n, 101n, 12_345n, 999_999n, 123_456_789n, 987_654_321_123n];
    for (const amount of amounts) {
      const lines = computeCommissionLines(amount, PLAN, chain(5));
      expect(totalDistributed(lines) <= bpsAmount(amount, DEFAULT_POOL_RATE_BPS)).toBe(true);
    }
  });

  it('0-cent satir yazilmaz', () => {
    // $0.19 satis: L4 (50bps) -> 0 cent, satir olusmaz
    const lines = computeCommissionLines(19n, PLAN, chain(5));
    expect(lines.every((l) => l.amountCents > 0n)).toBe(true);
    expect(lines.find((l) => l.level === 4)).toBeUndefined();
  });

  it('zincir plan derinliginden uzunsa fazlasi yok sayilir (kayan pencere)', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(10));
    expect(lines).toHaveLength(5);
    expect(Math.max(...lines.map((l) => l.level))).toBe(4);
  });
});
