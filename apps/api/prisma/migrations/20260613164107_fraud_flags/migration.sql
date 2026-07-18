-- CreateEnum
CREATE TYPE "FraudStatus" AS ENUM ('open', 'cleared', 'confirmed');

-- CreateTable
CREATE TABLE "fraud_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "status" "FraudStatus" NOT NULL DEFAULT 'open',
    "note" TEXT,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fraud_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fraud_flags_membership_id_key" ON "fraud_flags"("membership_id");

-- CreateIndex
CREATE INDEX "fraud_flags_tenant_id_status_idx" ON "fraud_flags"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fraud_flags" ADD CONSTRAINT "fraud_flags_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
