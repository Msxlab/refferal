-- AlterTable
ALTER TABLE "commission_plans" ADD COLUMN     "fast_start_bps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fast_start_days" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "matching_bps" INTEGER NOT NULL DEFAULT 0;
