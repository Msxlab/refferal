-- Values copied from a profile during an older migration are not proof that
-- they were captured for this payment instruction. Only reservation code sets
-- this marker, and batch CSV export requires it.
ALTER TABLE "payout_settlement_batch_items"
  ADD COLUMN IF NOT EXISTS "recipient_snapshot_at" TIMESTAMP(3);
