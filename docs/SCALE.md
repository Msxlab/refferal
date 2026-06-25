# Ölçek & Operasyon (Faz D7)

## ✅ Var (çalışıyor)
- **CI/CD** — `.github/workflows/ci.yml`: her push/PR'da postgres servisi + install + `prisma generate`
  + `lint` + `build` (tsc dahil) + `test` (unit) + `test:int` (entegrasyon, 154 test). Yeşil değilse merge yok.
- **Yük testi** — `docker/loadtest/load.js` (k6): 50 VU karışık okuma trafiği (dashboard/sales/members/cohorts),
  eşikler `http_req_failed<%1` + `p95<500ms`. `BASE=... EMAIL=... PASS=... k6 run docker/loadtest/load.js`.
  Eşik aşılırsa k6 non-zero döner → bir "perf gate" job'ı olarak CI'a eklenebilir (nightly önerilir).
- **Yedek/kurtarma** — günlük mantıksal yedek (`docker/backup`) + saniyelik PITR (`docs/PITR.md`).
- **Gözlemlenebilirlik** — Sentry + heartbeat + alarm (Faz B4–B6).

## 📋 Planlı (dokümante, kontrollü uygulanacak)
- **Şirketler-arası RLS** — `docs/RLS.md` (ikinci DB-zorlamalı izolasyon katmanı; staging-doğrulamalı sıra).

## Sürüm geri-alma (rollback)
- **Kod:** Docker imajları **etiketli** dağıtılır (örn. `:git-sha`). Geri-alma = önceki sha imajına dön
  (`docker compose` image tag'ini düşür + `up -d`). Stateless API/web → anında.
- **Şema:** migration'lar **ileri-yönlü**. Geri-alma gereken bir migration için: ya ileri-uyumlu yaz
  (önce kolon ekle, sonra eski kodu kaldır — iki-adımlı), ya da PITR ile (`docs/PITR.md`) migration
  öncesi ANA dön. Yıkıcı şema değişiminden ÖNCE taban yedek + WAL noktası işaretle.

## Deneme (staging) ortamı
- Aynı `docker-compose.yml` ile ayrı `.env` (farklı DOMAIN/DB/secret) → izole staging.
- RLS, yeni migration ve riskli değişiklikler ÖNCE burada test edilir (CI yeşil + staging smoke + yük testi).
- Prod'a yalnız staging'i geçen sürüm çıkar.

## Kapasite notları (bilinen sınırlar)
- `sanctions.isHit` tam-tablo tarar (audit'te işaretli) — büyük ölçekte indeksli sorguya çevrilmeli.
- `autoRequestPayouts` aday başına N sorgu (cron, gece) — 100k+ üyede toplu sorguya geçilmeli.
- Bunlar düşük öncelik (gece/off-peak) ama 6 haneli üye sayısından önce ele alınmalı.
