import { Prisma } from '@prisma/client';

/**
 * One transaction-scoped fence for every mutation that can change whether a
 * payout is safe to send (fraud, KYC, or sanctions).  Settlement and dispatch
 * take the same lock before their final compliance read, so a newly written
 * risk decision cannot slip in between that read and the financial transition.
 *
 * This is intentionally global rather than membership-scoped: sanctions list
 * updates can affect every tenant and a global fence is the only small,
 * auditable way to serialize that shared source of truth with payouts.
 */
const PAYOUT_RISK_LOCK_KEY = 'refearn:payout-risk-state:v1';

export async function lockPayoutRiskState(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${PAYOUT_RISK_LOCK_KEY}))
  `;
}
