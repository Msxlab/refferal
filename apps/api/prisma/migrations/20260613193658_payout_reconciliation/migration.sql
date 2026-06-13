-- AlterTable
ALTER TABLE "payouts" ADD COLUMN     "bank_ref" TEXT,
ADD COLUMN     "cleared_at" TIMESTAMP(3),
ADD COLUMN     "reconciled_by_user_id" UUID;
