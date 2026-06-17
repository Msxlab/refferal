# Refearn — Master Yol Haritası (modül bazında, sıralı)

> Çok-ajanlı modül değerlendirmesi (9 küme) + sentez, 2026-06. Motor/veri katmanı
> üretim-hazır; ürün, para çıkışının güvenli+uyumlu olduğunu GARANTI edemediği ve
> olduğunda FARK edemediği için henüz prod-hazır değil.
>
> NOT (triyaj): Faz 0'ın bazı "para bütünlüğü" maddeleri (period-lock enforcement,
> ACH BigInt sınırı) bu çalışmadaki 56-bulgulu audit remediation'da ZATEN düzeltildi —
> değerlendirme bunları eski bulgu olarak tekrar işaretledi. Her maddeyi koda karşı
> DOĞRULA, körlemesine "düzeltme".

## Faz 0 — Para Çıkışı Bütünlüğü & Compliance Gate (P0 BLOKER)
1. Payouts period-lock enforce (request/decide/batchApprove) — ✅ ZATEN YAPILDI (decide/retry advisory-lock'lu)
2. KYC gate: `requireKycForPayout` default false→true (opt-out→opt-in) + boş-profil state machine + admin review-queue UI — **GERÇEK (iş kararı)**
3. Fraud: manuel "cleared" admin karar workflow + payout pipeline'a kesin bağla — gerçek (doğrula)
4. Sanctions/OFAC: gerçek SDN refresh (mock 6-kayıt listeyi değiştir) + günlük refresh — **GERÇEK (L)**
5. ACH/NACHA: `Number(cents)` precision — ✅ GÜVENLI (üstte 9,999,999,999 sınır guard'ı var)
6. KYC secret: `decryptSecret` heap-exposure zeroize + TIN key escrow dokümante — gerçek (doğrula)

## Faz 1 — Güvenlik Sertleştirme: Kill-Switch (P0 BLOKER)
7. Kill-switch/suspend → refresh-token mass-revoke; member.setStatus token iptaliyle bağlansın — **GERÇEK**
8. JWT revocation: para-hassas endpoint'lerde fresh-DB teyit; token-family revoke — gerçek
9. Payout velocity/anomali check; çoklu-instance Redis throttle store — gerçek

## Faz 2 — Gözlemlenebilirlik & Operasyon (P0 BLOKER)
10. Observability: Sentry + pino JSON structured log + X-Request-ID — **GERÇEK (yok)**
11. Scheduler reliability: matureCommissions running-flag deadlock/stale recovery + job-health UI + alert — **GERÇEK**
12. /healthz: Redis + son-backup + cron-status; SIGTERM graceful drain — gerçek
13. Alerting: Slack/email alarm kanalı (security/backup/webhook-fail) — gerçek
14. Backup/DR: WAL archiving / PITR (pgBackRest/wal-g); secrets'i offsite'e dahil et — gerçek (L)

## Faz 3 — Finansal Tamamlanma & Veri Bütünlüğü (P1)
15. 1099-NEC: gerçek IRS filing (CSV'den öteye), TIN-missing backup-withholding, 1099-X — gerçek (L)
16. Reconcile: amount-only collision (payout_id binding); unmatched detay UI — gerçek
17. Engine E2E + concurrency stres testi (login→satış→onay→mature→payout→receipt) — gerçek
18. Summary/ledger verifier divergence root-cause + recovery — gerçek
19. Members/Network pagination (leaders 500-cap + uncapped tree) — gerçek

## Faz 4 — Satılabilirlik: Self-Servis Onboarding & Account (P1)
20. Guided onboarding checklist (import→plan→satış→davet) + first-run detection — gerçek
21. /account sayfası: profil/email-değişim/şifre-değişim/avatar/locale + GDPR deletion — **GERÇEK (tamamen yok)**
22. 2FA (TOTP): setup/challenge/recovery backend + UI; tenant policy — **GERÇEK (schema hazır, backend yok)**
23. Session mgmt: aktif oturum listesi + revoke; Device tablosunu auth'a bağla; eski-token cleanup cron — gerçek
24. Invite landing: "what you'll earn" önizleme + funnel event + UTM conversion — gerçek (S)

## Faz 5 — Platform-Admin & Operasyon Inbox (P1)
25. Platform-admin: tenant creation/onboarding + suspend/billing-state + usage-metering + health UI — **GERÇEK (STUB)**
26. Impersonation: POST /admin/impersonate (audit-flag + süreli + read-only) + banner — gerçek
27. Admin "needs attention" inbox (onay-bekleyen satış/payout/KYC/fraud/period) + trust-badge — gerçek
28. Notifications center: in-app inbox UI + editable tercih-matrisi + digest — gerçek
29. Webhooks/API-keys hardening: Idempotency-Key + DLQ + per-key scope/rotation — gerçek

## Faz 6 — Rekabet & Cila (P2)
30. Reports/analytics: cohort retention, churn-risk, funnel viz, PDF 1099, scheduling
31. Plan versioning + interaktif simulator UX (landing+onboarding)
32. Campaigns/ranks UX: bitiş ceremony, tiered-pool, rank-up celebration/history
33. Trust messaging: kalıcı "books verified" badge, KYC badge, payout receipt PDF/email, maturation timeline
34. Frontend: zengin empty-state, a11y (label/skip-link), i18n temizliği

## Faz 7 — Ölçek & DevEx (P2)
35. Performance/load testing (k6/Artillery) + p50/p95/p99 baseline
36. Staging & CI/CD parity + secret-scan + dependency-audit + migration-rollback testi
37. RLS (Postgres row-level security) — ikinci tenant prod'undan önce
38. Versioning/release: semver + git tag + CHANGELOG + image scanning
39. Audit-chain archival: hot→cold storage + GDPR purge + audit-alert

## Bu yol haritasının DIŞINDA (bilinçli Non-Goal / strateji)
- Binary/matrix/spillover yerleşim (SPEC.md:40 "asla" — karar kilitli, DECISIONS.md)
- Monetizasyon/billing (Stripe vb. tenant abonelik): PRODUCT-AUDIT.md'nin ana tezi —
  ürünü satılabilir yapan katman; Faz 5 platform-admin ile birlikte ele alınmalı (ürün kararı).
