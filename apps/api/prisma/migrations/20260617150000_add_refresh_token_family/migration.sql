-- Oturum (cihaz) kimligi: refresh-token rotasyonu boyunca SABIT kalir.
-- "Aktif oturumlar" listesi + tek-oturum revoke + "diger oturumlari kapat" bununla yapilir.
ALTER TABLE "refresh_tokens" ADD COLUMN "family_id" UUID;

CREATE INDEX "refresh_tokens_user_id_family_id_idx" ON "refresh_tokens" ("user_id", "family_id");
