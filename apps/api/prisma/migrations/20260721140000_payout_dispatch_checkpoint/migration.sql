-- A payout batch becomes non-releasable only after an operator explicitly
-- records that its payment instruction was dispatched.  This prevents a late
-- compliance change or a failed reconciliation step from returning money that
-- may already have reached the payment rail.
ALTER TYPE "PayoutSettlementBatchStatus" ADD VALUE IF NOT EXISTS 'dispatched';

ALTER TABLE "payout_settlement_batches"
  ADD COLUMN IF NOT EXISTS "dispatched_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dispatched_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "dispatch_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "dispatch_evidence" TEXT;
