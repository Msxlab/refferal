-- CreateEnum
CREATE TYPE "PayoutBatchStatus" AS ENUM ('proposed', 'executed', 'rejected');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "require_payout_approval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reserve_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reserve_percent" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "payout_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "status" "PayoutBatchStatus" NOT NULL DEFAULT 'proposed',
    "period" TEXT NOT NULL,
    "method" "PayoutMethod" NOT NULL DEFAULT 'manual',
    "membership_ids" TEXT[],
    "estimate_cents" BIGINT NOT NULL DEFAULT 0,
    "proposed_by_user_id" UUID NOT NULL,
    "approved_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "executed_at" TIMESTAMP(3),

    CONSTRAINT "payout_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payout_batches_tenant_id_status_idx" ON "payout_batches"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "payout_batches" ADD CONSTRAINT "payout_batches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
