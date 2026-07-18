-- AlterTable
ALTER TABLE "pending_invite_acceptances"
ADD COLUMN "tenant_id" UUID,
ADD COLUMN "disclaimer_version" TEXT,
ADD COLUMN "disclaimer_locale" TEXT,
ADD COLUMN "disclaimer_content_hash" TEXT,
ADD COLUMN "tenant_display_name" TEXT,
ADD COLUMN "program_summary" TEXT,
ADD COLUMN "program_summary_hash" TEXT,
ADD COLUMN "consent_accepted_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "invite_acceptance_consents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "invite_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "disclaimer_version" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "disclaimer_content_hash" TEXT NOT NULL,
    "tenant_display_name" TEXT NOT NULL,
    "program_summary" TEXT NOT NULL,
    "program_summary_hash" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_acceptance_consents_pkey" PRIMARY KEY ("id")
);

-- AddConstraint
ALTER TABLE "invite_acceptance_consents"
ADD CONSTRAINT "invite_acceptance_consents_invite_id_user_id_key"
UNIQUE ("invite_id", "user_id");

-- CreateIndex
CREATE INDEX "invite_acceptance_consents_tenant_id_accepted_at_idx"
ON "invite_acceptance_consents"("tenant_id", "accepted_at");

-- AddForeignKey
ALTER TABLE "invite_acceptance_consents"
ADD CONSTRAINT "invite_acceptance_consents_invite_id_fkey"
FOREIGN KEY ("invite_id") REFERENCES "invites"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_acceptance_consents"
ADD CONSTRAINT "invite_acceptance_consents_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_acceptance_consents"
ADD CONSTRAINT "invite_acceptance_consents_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_acceptance_consents"
ADD CONSTRAINT "invite_acceptance_consents_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
