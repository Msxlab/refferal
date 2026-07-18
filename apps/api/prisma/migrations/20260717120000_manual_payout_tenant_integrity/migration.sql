CREATE UNIQUE INDEX "memberships_tenant_id_id_uidx"
ON "memberships"("tenant_id", "id");

ALTER TABLE "payout_readiness_checks"
DROP CONSTRAINT "payout_readiness_checks_membership_id_fkey";

ALTER TABLE "payout_readiness_checks"
ADD CONSTRAINT "payout_readiness_checks_tenant_membership_fkey"
FOREIGN KEY ("tenant_id", "membership_id")
REFERENCES "memberships"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "payout_destinations"
DROP CONSTRAINT "payout_destinations_membership_id_fkey";

ALTER TABLE "payout_destinations"
ADD CONSTRAINT "payout_destinations_tenant_membership_fkey"
FOREIGN KEY ("tenant_id", "membership_id")
REFERENCES "memberships"("tenant_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;
