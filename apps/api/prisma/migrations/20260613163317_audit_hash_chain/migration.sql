-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "hash" TEXT,
ADD COLUMN     "prev_hash" TEXT;
