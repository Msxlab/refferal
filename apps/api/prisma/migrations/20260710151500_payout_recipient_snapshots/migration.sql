-- A payment instruction must remain byte-for-byte stable after processing starts.
-- New processing payouts copy these mutable member details once; older rows stay null
-- and are deliberately not exported as a fresh instruction.
ALTER TABLE "payouts"
  ADD COLUMN IF NOT EXISTS "recipient_referral_code" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_full_name" TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_email" TEXT;
