-- Faz A3: esigi gecen uyeye gece job'u otomatik 'requested' cek talebi acar (admin onayi hala sart).
ALTER TABLE "tenants" ADD COLUMN "auto_request_payouts" BOOLEAN NOT NULL DEFAULT true;
