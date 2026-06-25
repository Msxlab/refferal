-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "require_kyc_for_payout" BOOLEAN NOT NULL DEFAULT false;
