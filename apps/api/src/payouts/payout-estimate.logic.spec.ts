import { computeEstimateDate, nextAutoRequestAt } from './payout-estimate.logic';

const TZ = 'America/New_York';

describe('nextAutoRequestAt', () => {
  it('now before 06:00 local -> today 06:00 local (summer EDT = UTC-4)', () => {
    const now = new Date('2026-06-15T09:00:00.000Z'); // 05:00 EDT
    expect(nextAutoRequestAt(now, TZ).toISOString()).toBe('2026-06-15T10:00:00.000Z');
  });

  it('now after 06:00 local -> tomorrow 06:00 local (summer EDT)', () => {
    const now = new Date('2026-06-15T12:00:00.000Z'); // 08:00 EDT
    expect(nextAutoRequestAt(now, TZ).toISOString()).toBe('2026-06-16T10:00:00.000Z');
  });

  it('winter EST (UTC-5): before 06:00 -> today 11:00Z', () => {
    const now = new Date('2026-01-15T09:00:00.000Z'); // 04:00 EST
    expect(nextAutoRequestAt(now, TZ).toISOString()).toBe('2026-01-15T11:00:00.000Z');
  });
});

describe('computeEstimateDate', () => {
  const now = new Date('2026-06-15T12:00:00.000Z'); // 08:00 EDT -> nextAutoRequest = 2026-06-16T10:00:00Z
  const D1 = new Date('2026-07-01T00:00:00.000Z');
  const D2 = new Date('2026-07-10T00:00:00.000Z');

  it('already eligible (payable >= min) -> next auto-request datetime', () => {
    const out = computeEstimateDate({
      payableCents: 100000n, payoutMinCents: 100000n, pending: [], now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe('2026-06-16T10:00:00.000Z');
  });

  it('crosses threshold on the second pending piece -> that maturesAt', () => {
    const out = computeEstimateDate({
      payableCents: 0n, payoutMinCents: 100000n,
      pending: [{ amountCents: 50000n, maturesAt: D1 }, { amountCents: 60000n, maturesAt: D2 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D2.toISOString());
  });

  it('unsorted pending is sorted by maturesAt before walking', () => {
    const out = computeEstimateDate({
      payableCents: 0n, payoutMinCents: 100000n,
      pending: [{ amountCents: 60000n, maturesAt: D2 }, { amountCents: 50000n, maturesAt: D1 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D2.toISOString()); // D1(50k)+D2(60k)=110k crosses at D2
  });

  it('never reaches threshold -> null', () => {
    const out = computeEstimateDate({
      payableCents: 0n, payoutMinCents: 100000n,
      pending: [{ amountCents: 30000n, maturesAt: D1 }, { amountCents: 20000n, maturesAt: D2 }],
      now, timezone: TZ,
    });
    expect(out).toBeNull();
  });

  it('partial payable + one pending crosses exactly -> that maturesAt', () => {
    const out = computeEstimateDate({
      payableCents: 40000n, payoutMinCents: 100000n,
      pending: [{ amountCents: 60000n, maturesAt: D1 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D1.toISOString());
  });

  it('handles large BigInt cents without precision loss', () => {
    const out = computeEstimateDate({
      payableCents: 9_007_199_254_740_993n, payoutMinCents: 9_007_199_254_740_994n,
      pending: [{ amountCents: 1n, maturesAt: D1 }],
      now, timezone: TZ,
    });
    expect(out?.toISOString()).toBe(D1.toISOString());
  });
});
