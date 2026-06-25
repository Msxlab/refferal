-- Faz A2: cek ile odeme. Yeni payout yontemi 'check' + uye posta adresi (cek buraya postalanir).

-- enum'a 'check' degerini ekle (PG12+; ayni migration'da KULLANILMADIGI icin tek dosya guvenli)
ALTER TYPE "PayoutMethod" ADD VALUE IF NOT EXISTS 'check';

-- uye posta adresi (self-servis Account'tan; payout aninda Payout'a snapshot'lanir)
ALTER TABLE "memberships" ADD COLUMN "mailing_name" TEXT;
ALTER TABLE "memberships" ADD COLUMN "mailing_line1" TEXT;
ALTER TABLE "memberships" ADD COLUMN "mailing_line2" TEXT;
ALTER TABLE "memberships" ADD COLUMN "mailing_city" TEXT;
ALTER TABLE "memberships" ADD COLUMN "mailing_state" TEXT;
ALTER TABLE "memberships" ADD COLUMN "mailing_postal" TEXT;
ALTER TABLE "memberships" ADD COLUMN "mailing_country" TEXT DEFAULT 'US';
