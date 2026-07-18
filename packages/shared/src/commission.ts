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
 * Pure engine core (SPEC 7, step 4): sliding-window distribution.
 *
 * uplineChain[0] is the seller; uplineChain[i] is the i-th upline sponsor, limited by plan depth.
 * - Missing chain levels do not produce rows; the share stays with the company (SPEC 3.3).
 * - Amount is floor(amount * rate / 10000); 0-cent results do not produce rows.
 * - Inactive-member and compression decisions happen in the engine before this function receives the chain.
 *   This function only distributes the window it is given.
 *
 * This function is fully independent from the database. The plan simulator and interactive landing demo use it too.
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
    if (!beneficiary) continue; // missing upline: share is not distributed and stays with the company

    const amount = bpsAmount(amountCents, rateBps);
    if (amount <= 0n) continue; // 0-cent rows are not written

    lines.push({ level, beneficiaryMembershipId: beneficiary, rateBpsUsed: rateBps, amountCents: amount });
  }

  return lines;
}

/** Total distributed for one sale; invariant check: total <= amount * pool_rate. */
export function totalDistributed(lines: CommissionLine[]): bigint {
  return lines.reduce((acc, l) => acc + l.amountCents, 0n);
}
