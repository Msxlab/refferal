-- Payout settlement is a two-phase state machine. Existing paid rows deliberately
-- retain null settlement metadata: this migration does not invent transfer proof.
ALTER TYPE "LedgerStatus" ADD VALUE IF NOT EXISTS 'processing';
DO $$
BEGIN
  CREATE TYPE "PayoutSettlementBatchStatus" AS ENUM ('processing', 'settled', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "monthly_summaries"
  ADD COLUMN IF NOT EXISTS "processing_cents" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "ledger_entries"
  ADD COLUMN IF NOT EXISTS "payout_batch_id" UUID;

ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "batch_id" UUID,
  ADD COLUMN IF NOT EXISTS "active_key" TEXT,
  ADD COLUMN IF NOT EXISTS "processing_started_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "processing_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "settled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "settled_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "settlement_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "settlement_evidence" TEXT,
  ADD COLUMN IF NOT EXISTS "rejected_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejected_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "failed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failed_by_user_id" UUID,
  ADD COLUMN IF NOT EXISTS "failure_reason" TEXT;

CREATE TABLE IF NOT EXISTS "payout_settlement_batches" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "method" "PayoutMethod" NOT NULL,
  "status" "PayoutSettlementBatchStatus" NOT NULL DEFAULT 'processing',
  "csv_checksum" TEXT,
  "processing_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processing_by_user_id" UUID,
  "settled_at" TIMESTAMP(3),
  "settled_by_user_id" UUID,
  "settlement_reference" TEXT,
  "settlement_evidence" TEXT,
  "failed_at" TIMESTAMP(3),
  "failed_by_user_id" UUID,
  "failure_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "payout_settlement_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "payout_settlement_batch_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batch_id" UUID NOT NULL,
  "payout_id" UUID NOT NULL,
  "ledger_entry_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "month" TEXT NOT NULL,
  "level" INTEGER NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payout_settlement_batch_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "payout_settlement_batch_items_batch_id_ledger_entry_id_key"
  ON "payout_settlement_batch_items"("batch_id", "ledger_entry_id");
CREATE INDEX IF NOT EXISTS "payout_settlement_batch_items_payout_id_idx" ON "payout_settlement_batch_items"("payout_id");
CREATE INDEX IF NOT EXISTS "payout_settlement_batch_items_ledger_entry_id_idx" ON "payout_settlement_batch_items"("ledger_entry_id");
CREATE INDEX IF NOT EXISTS "payout_settlement_batches_tenant_id_status_processing_started_at_idx"
  ON "payout_settlement_batches"("tenant_id", "status", "processing_started_at");
CREATE INDEX IF NOT EXISTS "ledger_entries_settlement_batch_id_status_idx"
  ON "ledger_entries"("payout_batch_id", "status");
CREATE INDEX IF NOT EXISTS "payouts_settlement_batch_id_status_idx" ON "payouts"("batch_id", "status");

-- New active rows get a key in application code. Legacy requested rows keep NULL,
-- avoiding an unsafe historical deduplication while enforcing future idempotency.
CREATE UNIQUE INDEX IF NOT EXISTS "payouts_active_key_unique"
  ON "payouts"("active_key")
  WHERE "active_key" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_settlement_batches_tenant_id_fkey') THEN
    ALTER TABLE "payout_settlement_batches"
      ADD CONSTRAINT "payout_settlement_batches_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payouts_settlement_batch_id_fkey') THEN
    ALTER TABLE "payouts"
      ADD CONSTRAINT "payouts_settlement_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "payout_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_entries_settlement_batch_id_fkey') THEN
    ALTER TABLE "ledger_entries"
      ADD CONSTRAINT "ledger_entries_settlement_batch_id_fkey"
      FOREIGN KEY ("payout_batch_id") REFERENCES "payout_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_settlement_batch_items_batch_id_fkey') THEN
    ALTER TABLE "payout_settlement_batch_items"
      ADD CONSTRAINT "payout_settlement_batch_items_batch_id_fkey"
      FOREIGN KEY ("batch_id") REFERENCES "payout_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_settlement_batch_items_payout_id_fkey') THEN
    ALTER TABLE "payout_settlement_batch_items"
      ADD CONSTRAINT "payout_settlement_batch_items_payout_id_fkey"
      FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payout_settlement_batch_items_ledger_entry_id_fkey') THEN
    ALTER TABLE "payout_settlement_batch_items"
      ADD CONSTRAINT "payout_settlement_batch_items_ledger_entry_id_fkey"
      FOREIGN KEY ("ledger_entry_id") REFERENCES "ledger_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
