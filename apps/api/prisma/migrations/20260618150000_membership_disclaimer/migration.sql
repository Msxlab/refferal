-- Faz A1: kayit disclaimer'i. Uye kayitta sorumluluk metnini onaylar (hukuki kayit).
ALTER TABLE "memberships" ADD COLUMN "disclaimer_accepted_at" TIMESTAMP(3);
ALTER TABLE "memberships" ADD COLUMN "disclaimer_version" TEXT;
