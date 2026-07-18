-- The batch item is the authoritative immutable payment-instruction snapshot.
-- Keep columns nullable for rows produced before this migration; export refuses a
-- legacy row without a snapshot instead of substituting mutable profile data.
ALTER TABLE "payout_settlement_batch_items"
  ADD COLUMN IF NOT EXISTS "recipient_referral_code" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_full_name" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_email" TEXT;

-- Backfill only where the linked recipient still exists. This makes any
-- pre-snapshot batches exportable when their current profile is known, while
-- preserving an explicit null (and safe export rejection) for anomalous rows.
UPDATE "payout_settlement_batch_items" AS item
SET "recipient_referral_code" = membership.referral_code,
    "recipient_full_name" = "user".full_name,
    "recipient_email" = "user".email
FROM memberships AS membership
JOIN users AS "user" ON "user".id = membership.user_id
WHERE item.membership_id = membership.id
  AND (
    item."recipient_referral_code" IS NULL
    OR item."recipient_full_name" IS NULL
    OR item."recipient_email" IS NULL
  );
