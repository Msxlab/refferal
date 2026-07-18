-- JWTs and refresh sessions created before this migration intentionally lack a generation and fail closed.
ALTER TABLE "users" ADD COLUMN "auth_generation" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "refresh_tokens" ADD COLUMN "auth_generation" INTEGER;

CREATE TABLE "pending_invite_acceptances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "challenge_token_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pending_invite_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_invite_acceptances_challenge_token_id_key"
ON "pending_invite_acceptances"("challenge_token_id");

CREATE INDEX "pending_invite_acceptances_user_id_invite_id_idx"
ON "pending_invite_acceptances"("user_id", "invite_id");

ALTER TABLE "pending_invite_acceptances"
ADD CONSTRAINT "pending_invite_acceptances_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pending_invite_acceptances"
ADD CONSTRAINT "pending_invite_acceptances_invite_id_fkey"
FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pending_invite_acceptances"
ADD CONSTRAINT "pending_invite_acceptances_challenge_token_id_fkey"
FOREIGN KEY ("challenge_token_id") REFERENCES "user_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
