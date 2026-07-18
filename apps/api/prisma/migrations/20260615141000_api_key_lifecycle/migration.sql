-- API anahtari yasam-dongusu (guvenlik denetimi): opsiyonel son-kullanma + uyelige FK (cascade).
-- Guard her istekte uyelik/kiraci aktif mi + sure dolmus mu kontrol eder; uye pasiflesince
-- veya silinince anahtar da gecersiz olur (cascade-revoke uygulama katmaninda, FK silinmede).

-- AlterTable: opsiyonel son-kullanma tarihi
ALTER TABLE "api_keys" ADD COLUMN "expires_at" TIMESTAMP(3);

-- CreateIndex: membership_id sorgulari (cascade-revoke + lookup)
CREATE INDEX "api_keys_membership_id_idx" ON "api_keys"("membership_id");

-- AddForeignKey: api_keys.membership_id -> memberships.id (uye silinince anahtar da silinir)
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
