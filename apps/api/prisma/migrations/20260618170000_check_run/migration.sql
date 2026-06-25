-- Faz A2.2: cek-run. Sirali cek numarasi sayaci (tenant) + payout cek alanlari (no/adres-snapshot/mailed).

ALTER TABLE "tenants" ADD COLUMN "last_check_number" INTEGER NOT NULL DEFAULT 1000;

ALTER TABLE "payouts" ADD COLUMN "check_number" INTEGER;
ALTER TABLE "payouts" ADD COLUMN "mailed_at" TIMESTAMP(3);
ALTER TABLE "payouts" ADD COLUMN "payee_snapshot" JSONB;
