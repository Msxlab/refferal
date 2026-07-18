-- Fail safely rather than silently choosing a surviving open credential.
-- Remediate duplicate live tokens before retrying this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM user_tokens
    WHERE used_at IS NULL
    GROUP BY user_id, purpose
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot enforce one live user token per purpose: duplicate open tokens exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pending_invite_acceptances AS pending
    JOIN user_tokens AS token ON token.id = pending.challenge_token_id
    WHERE pending.user_id <> token.user_id
  ) THEN
    RAISE EXCEPTION 'cannot enforce pending invite challenge ownership: mismatched user/token rows exist';
  END IF;
END $$;

ALTER TABLE "invites"
  ADD COLUMN IF NOT EXISTS "idempotency_key_hash" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "user_tokens_one_live_per_purpose_uidx"
  ON "user_tokens"("user_id", "purpose")
  WHERE "used_at" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "invites_inviter_idempotency_key_hash_uidx"
  ON "invites"("inviter_membership_id", "idempotency_key_hash");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_tokens_user_id_id_key'
  ) THEN
    ALTER TABLE "user_tokens"
      ADD CONSTRAINT "user_tokens_user_id_id_key" UNIQUE ("user_id", "id");
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pending_invite_acceptances_user_challenge_owner_fkey'
  ) THEN
    ALTER TABLE "pending_invite_acceptances"
      ADD CONSTRAINT "pending_invite_acceptances_user_challenge_owner_fkey"
      FOREIGN KEY ("user_id", "challenge_token_id")
      REFERENCES "user_tokens"("user_id", "id")
      ON DELETE CASCADE
      ON UPDATE CASCADE
      NOT VALID;
  END IF;
END $$;

ALTER TABLE "pending_invite_acceptances"
  VALIDATE CONSTRAINT "pending_invite_acceptances_user_challenge_owner_fkey";
