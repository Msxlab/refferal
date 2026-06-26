-- Faz E: tahmini odeme tarihi (turetilmis, nullable). Mevcut para mantigina dokunmaz.
-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "estimated_payout_date" TIMESTAMP(3),
ADD COLUMN     "estimated_payout_at" TIMESTAMP(3);
