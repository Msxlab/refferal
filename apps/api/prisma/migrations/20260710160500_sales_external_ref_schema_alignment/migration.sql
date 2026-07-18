-- Prisma's compound unique selector requires a full unique index. PostgreSQL
-- permits multiple NULL values in a full unique index, preserving the prior
-- partial-index behavior for sales without an external reference.
DROP INDEX IF EXISTS "sales_tenant_external_ref_uidx";

CREATE UNIQUE INDEX "sales_tenant_external_ref_uidx"
  ON "sales"("tenant_id", "external_ref");

-- Match the composite one-to-one relation used to enforce challenge ownership.
-- challenge_token_id is already unique, so this is data-safe and schema-visible.
CREATE UNIQUE INDEX IF NOT EXISTS "pending_invite_acceptances_user_challenge_token_key"
  ON "pending_invite_acceptances"("user_id", "challenge_token_id");
