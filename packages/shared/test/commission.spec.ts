import {
  bpsAmount,
  centsToDecimalString,
  commissionPlanSchema,
  computeCommissionLines,
  totalDistributed,
  DEFAULT_LEVEL_RATES_BPS,
  DEFAULT_POOL_RATE_BPS,
  type CommissionLine,
} from '../src';

const PLAN = DEFAULT_LEVEL_RATES_BPS.map((rateBps, level) => ({ level, rateBps }));
const chain = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`);

describe('money helpers (SPEC 3.5)', () => {
  it('bpsAmount applies floor rounding', () => {
    expect(bpsAmount(999n, 500)).toBe(49n); // 49.95 -> 49
    expect(bpsAmount(10_000n, 1)).toBe(1n);
    expect(bpsAmount(9_999n, 1)).toBe(0n);
    expect(bpsAmount(0n, 500)).toBe(0n);
  });

  it('rejects negative amounts and invalid rates', () => {
    expect(() => bpsAmount(-1n, 500)).toThrow(RangeError);
    expect(() => bpsAmount(100n, -1)).toThrow(RangeError);
    expect(() => bpsAmount(100n, 10_001)).toThrow(RangeError);
    expect(() => bpsAmount(100n, 5.5)).toThrow(RangeError);
  });

  it('centsToDecimalString handles sign and padding correctly', () => {
    expect(centsToDecimalString(123456n)).toBe('1234.56');
    expect(centsToDecimalString(-50n)).toBe('-0.50');
    expect(centsToDecimalString(0n)).toBe('0.00');
  });
});

describe('plan validation (SPEC 3.2)', () => {
  const valid = {
    name: 'Standard',
    poolRateBps: DEFAULT_POOL_RATE_BPS,
    depth: 5,
    levels: PLAN,
  };

  it('accepts the standard Axtra plan', () => {
    expect(commissionPlanSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects SUM(level_rates) greater than pool_rate', () => {
    const levels = [{ level: 0, rateBps: 900 }, { level: 1, rateBps: 200 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 2, levels }).success).toBe(false);
  });

  it('requires level 0 (seller)', () => {
    const levels = [{ level: 1, rateBps: 100 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 1, levels }).success).toBe(false);
  });

  it('rejects level gaps and duplicates', () => {
    const gap = [{ level: 0, rateBps: 100 }, { level: 2, rateBps: 100 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 3, levels: gap }).success).toBe(false);

    const dup = [{ level: 0, rateBps: 100 }, { level: 0, rateBps: 100 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 2, levels: dup }).success).toBe(false);
  });

  it('rejects negative rates', () => {
    const levels = [{ level: 0, rateBps: -1 }];
    expect(commissionPlanSchema.safeParse({ ...valid, depth: 1, levels }).success).toBe(false);
  });
});

describe('computeCommissionLines - pure core (SPEC 11)', () => {
  it('T1: $100,000 sale with 4+ uplines distributes 5000/2000/1500/1000/500 = $10,000', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(5));
    expect(lines.map((l) => l.amountCents)).toEqual([500_000n, 200_000n, 150_000n, 100_000n, 50_000n]);
    expect(lines.map((l) => l.beneficiaryMembershipId)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']);
    expect(totalDistributed(lines)).toBe(1_000_000n);
  });

  it('T2: founder sells with no upline, so only the seller receives $5,000', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(1));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: 0, beneficiaryMembershipId: 'm0', amountCents: 500_000n });
    expect(totalDistributed(lines)).toBe(500_000n); // remaining $5,000 is not distributed
  });

  it('T3: only 2 uplines writes L0/L1/L2 and no L3/L4 lines', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(3));
    expect(lines.map((l) => l.level)).toEqual([0, 1, 2]);
    expect(lines.map((l) => l.amountCents)).toEqual([500_000n, 200_000n, 150_000n]);
  });

  it('T8: fairness - L1 and L7 members with identical downlines earn the same amount', () => {
    // Trunk: m0 (root) -> m1 -> ... -> m6. A = m1 (depth 1), B = m6 (depth 6 / "L7").
    const trunk = chain(7);
    const upline = (idx: number) => trunk.slice(0, idx + 1).reverse(); // [self, sponsor, ...]

    const earningsWithDownline = (member: string, memberUpline: string[]) => {
      // Identical downline: a 4-person chain under the member, with everyone selling $10,000.
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

  it('T9: $33,333 sale floors every level, total stays under 10%, remainder stays with the company', () => {
    const amount = 3_333_300n; // $33.333,00
    const lines = computeCommissionLines(amount, PLAN, chain(5));
    expect(lines.map((l) => l.amountCents)).toEqual([166_665n, 66_666n, 49_999n, 33_333n, 16_666n]);

    const pool = bpsAmount(amount, DEFAULT_POOL_RATE_BPS); // 333.330
    expect(totalDistributed(lines)).toBe(333_329n);
    expect(totalDistributed(lines) <= pool).toBe(true); // 1 cent remains with the company
  });

  it('invariant: total distribution never exceeds the pool for representative amounts', () => {
    const amounts = [1n, 7n, 99n, 101n, 12_345n, 999_999n, 123_456_789n, 987_654_321_123n];
    for (const amount of amounts) {
      const lines = computeCommissionLines(amount, PLAN, chain(5));
      expect(totalDistributed(lines) <= bpsAmount(amount, DEFAULT_POOL_RATE_BPS)).toBe(true);
    }
  });

  it('does not write 0-cent lines', () => {
    // $0.19 sale: L4 (50bps) -> 0 cents, so no line is created.
    const lines = computeCommissionLines(19n, PLAN, chain(5));
    expect(lines.every((l) => l.amountCents > 0n)).toBe(true);
    expect(lines.find((l) => l.level === 4)).toBeUndefined();
  });

  it('ignores chain entries beyond plan depth', () => {
    const lines = computeCommissionLines(10_000_000n, PLAN, chain(10));
    expect(lines).toHaveLength(5);
    expect(Math.max(...lines.map((l) => l.level))).toBe(4);
  });
});

describe('yerlesim degismezi: komisyon SPONSOR zinciriyle akar, ltree path DEGIL (docs/DECISIONS.md 2026-06-16)', () => {
  // Urun karari kilidi: tek sponsor agaci; spillover/binary/matrix YOK (SPEC.md:40 "asla").
  // computeCommissionLines imzasi YALNIZ uplineChain alir — path/placement parametresi YOKTUR,
  // yani ltree path komisyonu YAPISAL OLARAK etkileyemez. Motor (engine.service.ts uplineChain)
  // bu zinciri sponsorMembershipId'den kurar. Biri ileride 'placement_path' ekleyip motoru ona
  // gore degistirirse bu testler kirilir (kasitli mimari regresyon kilidi).

  it('beneficiary her zaman SPONSOR-zincirindeki o seviyenin uyesidir (uplineChain[level])', () => {
    const sponsorChain = ['seller', 'sponsorL1', 'sponsorL2', 'sponsorL3', 'sponsorL4'];
    const lines = computeCommissionLines(10_000_000n, PLAN, sponsorChain);
    for (const l of lines) {
      expect(l.beneficiaryMembershipId).toBe(sponsorChain[l.level]);
    }
  });

  it('ayni uyeler farkli SPONSOR sirasinda farkli dagilir — para sponsor sirasini izler, sabit yerlesimi degil', () => {
    const amount = 10_000_000n;
    // Ayni 3 uye, ters sponsor zinciri. Fonksiyon hicbir 'path' gormez; tek belirleyici sira.
    const a = computeCommissionLines(amount, PLAN, ['x', 'y', 'z']);
    const b = computeCommissionLines(amount, PLAN, ['z', 'y', 'x']);
    expect(a.find((l) => l.level === 0)!.beneficiaryMembershipId).toBe('x');
    expect(b.find((l) => l.level === 0)!.beneficiaryMembershipId).toBe('z');
    const earn = (lines: CommissionLine[], m: string) =>
      lines.filter((l) => l.beneficiaryMembershipId === m).reduce((s, l) => s + l.amountCents, 0n);
    // x: A'da L0 (en yuksek pay), B'de L2 (daha dusuk) -> toplam kazanc FARKLI
    expect(earn(a, 'x')).not.toBe(earn(b, 'x'));
  });
});
