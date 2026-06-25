-- CreateEnum
CREATE TYPE "PayoutProfileStatus" AS ENUM ('unverified', 'pending_review', 'verified', 'rejected');

-- CreateEnum
CREATE TYPE "TaxIdType" AS ENUM ('ssn', 'ein');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('checking', 'savings');

-- CreateTable
CREATE TABLE "payout_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "legal_name" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'US',
    "tax_id_type" "TaxIdType" NOT NULL,
    "tax_id_last4" TEXT NOT NULL,
    "bank_name" TEXT,
    "routing_number" TEXT NOT NULL,
    "account_type" "BankAccountType" NOT NULL,
    "account_last4" TEXT NOT NULL,
    "status" "PayoutProfileStatus" NOT NULL DEFAULT 'pending_review',
    "rejection_reason" TEXT,
    "last_changed_at" TIMESTAMP(3) NOT NULL,
    "reviewed_by_user_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payout_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payout_profiles_membership_id_key" ON "payout_profiles"("membership_id");

-- CreateIndex
CREATE INDEX "payout_profiles_tenant_id_status_idx" ON "payout_profiles"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "payout_profiles" ADD CONSTRAINT "payout_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payout_profiles" ADD CONSTRAINT "payout_profiles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
