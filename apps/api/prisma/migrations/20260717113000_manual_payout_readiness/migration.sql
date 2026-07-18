CREATE TYPE "PayoutReadinessCheckKey" AS ENUM ('address', 'kyc', 'fraud', 'sanctions', 'payment_method');

CREATE TYPE "PayoutReadinessDecisionStatus" AS ENUM ('pending', 'ready', 'blocked');

CREATE TABLE "payout_readiness_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "key" "PayoutReadinessCheckKey" NOT NULL,
    "status" "PayoutReadinessDecisionStatus" NOT NULL DEFAULT 'pending',
    "reason_code" TEXT NOT NULL,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_readiness_checks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payout_readiness_checks_version_chk" CHECK ("version" > 0)
);

CREATE TABLE "payout_destinations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "provider_reference" TEXT NOT NULL,
    "masked_label" TEXT NOT NULL,
    "last4" TEXT,
    "country" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "verified_by_user_id" UUID,
    "verified_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_destinations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payout_destinations_version_chk" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "payout_readiness_checks_tenant_membership_key_uidx"
ON "payout_readiness_checks"("tenant_id", "membership_id", "key");

CREATE INDEX "payout_readiness_checks_tenant_status_expiry_idx"
ON "payout_readiness_checks"("tenant_id", "status", "expires_at");

CREATE INDEX "payout_destinations_tenant_membership_active_idx"
ON "payout_destinations"("tenant_id", "membership_id", "active");

CREATE UNIQUE INDEX "payout_destinations_one_active_per_member_uidx"
ON "payout_destinations"("tenant_id", "membership_id")
WHERE "active";

ALTER TABLE "payout_readiness_checks"
ADD CONSTRAINT "payout_readiness_checks_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payout_readiness_checks"
ADD CONSTRAINT "payout_readiness_checks_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payout_readiness_checks"
ADD CONSTRAINT "payout_readiness_checks_reviewed_by_user_id_fkey"
FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payout_destinations"
ADD CONSTRAINT "payout_destinations_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payout_destinations"
ADD CONSTRAINT "payout_destinations_membership_id_fkey"
FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payout_destinations"
ADD CONSTRAINT "payout_destinations_verified_by_user_id_fkey"
FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
