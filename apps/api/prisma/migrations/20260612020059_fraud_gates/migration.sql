-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "created_by" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "require_separate_approver" BOOLEAN NOT NULL DEFAULT false;
