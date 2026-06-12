# Refearn — End-to-End Product Blueprint

> Bu doküman Refearn'ü oyuncak bir araçtan, başka şirketlere satılabilir gerçek bir B2B
> referans/komisyon SaaS'ına taşıyan **tam** plandır. Tasarım dili: docs/DESIGN-VISION.md
> ("Obsidian & Champagne", light/dark, EN). Güvenlik/yedek temeli: docs/DECISIONS.md.
> Sistem dili **İngilizce**.

İşaretler: ✅ var · 🟡 kısmi · ❌ yok

---

## 0. Yüzeyler (3 ayrı uygulama)

| Yüzey | Kim | URL |
|---|---|---|
| **Member app** | Üye | `/app` (web) + Expo mobil |
| **Tenant admin** | İşletme yöneticisi | `/admin` |
| **Platform admin** | Axtra (SaaS sahibi) | `platform.x.com` ❌ |
| Public | Ziyaretçi + davetli | `/`, `/i/{code}` |

---

## 1. Identity & Authentication (giriş güvenliği)

**Mevcut:** argon2id ✅, rotasyonlu refresh + reuse-detection ✅, timing-safe login ✅,
rate-limit (auth 10/dk) ✅, güvenlik olay logu ✅, e-posta doğrulama kapısı ✅.

**Eklenecek:**
- **2FA (TOTP)** ❌ — QR kurulum + recovery kodları + tenant-geneli "2FA zorunlu" politikası. `users.totpSecret` zaten var.
- **Aktif oturumlar** ❌ — cihaz/konum/IP/son-aktivite listesi + "bu oturumu kapat" / "tüm diğer oturumları kapat".
- **Login sertleştirme** 🟡 — ardışık başarısızlıkta geçici hesap kilidi (lockout), CAPTCHA (N denemeden sonra), "yeni cihazdan giriş" e-posta uyarısı.
- **Parola politikası** ❌ — min uzunluk/zayıf-parola sözlüğü (HaveIBeenPwned k-anon opsiyonel), parola değişiminde tüm oturum iptali (✅ var).
- **Şifre sıfırlama** ✅ — token tek-kullanım, enumeration-safe ✅.
- **JWT iptali** ❌ — para uçlarında her istekte DB'den taze rol/durum teyidi (pasifleşen yetkili 15dk yetkili kalmasın).
- **SSO/SAML/SCIM** ❌ — Enterprise faz (placeholder). Self-hosted SPEC gereği harici BaaS yok; kendi OIDC sağlayıcımız ya da Faz 3.
- **Account management** ❌ — profil (ad/avatar/locale), e-posta değiştir (doğrulamalı), parola değiştir, 2FA, oturumlar, hesabı kapat (geri-alınamaz onay).

---

## 2. Authorization / RBAC (yetkilendirme)

**Mevcut:** 5 sabit rol (`platform_admin > tenant_owner > tenant_admin > tenant_staff > member`) ✅,
guard + @Roles ✅, tenant-scope (servis katmanı where) ✅.

**Eklenecek:**
- **İzin matrisi (permission grid)** ❌ — aksiyon × rol matrisi: kim satış girer/onaylar/void eder, payout çalıştırır, plan değiştirir, üye yönetir, ayar değiştirir, audit görür. UI'da görsel matris (Settings > Roles).
- **Özel roller (custom roles)** ❌ (Enterprise) — tenant kendi rolünü tanımlar (örn. "Finance" = payout+reports, satış yok).
- **Gorevler ayrımı (SoD)** ✅ — maker-checker (satışı giren onaylayamaz, tenant ayarı).
- **RLS (Postgres row-level security)** ❌ — kritik tablolara ikinci kilit (Americana 2. tenant öncesi şart).
- **Prisma tenant-middleware** ❌ — her sorguya otomatik tenant filtresi (unutulan where = sızıntı).
- **API keys** ❌ — programatik erişim (kapsam + son-kullanım + revoke), Developer ayarları.

---

## 3. Member app (üye yüzeyi) — web + mobil

| Modül | Mevcut | Eklenecek (fonksiyon/buton) |
|---|---|---|
| **Overview** | 🟡 hero+donut+bar | Kazanç trend grafiği, dönem seçici, rütbe rozeti+ilerleme, "what's new" akışı |
| **Wallet** | 🟡 bakiye+ledger | Kazanç trend grafiği, **pending→payable vade takvimi** (maturesAt var), seviye-kaynak dağılım donut, payout durum timeline, **PDF ekstre indir**, ledger filtre/arama |
| **Team** | 🟡 tek bar | KPI şerit (total/active/new/30g büyüme/en derin seviye), 12-haftalık büyüme trendi, gizlilikli yeni-katılım activity feed, rütbe ilerleme |
| **Network (ağaç)** | ❌ | **Gizlilik-korumalı radial "My Network"**: merkez You, L1 isimli, L2+ agregat balon. Zoom/pan. |
| **Invite** | 🟡 QR+link | Markalı **luxury davet kartı** (PNG export), sosyal paylaşım (WhatsApp/Telegram/Email/X), **durum takibi** (Pending/Opened/Joined), davet funnel/dönüşüm, e-posta daveti |
| **Gamification** | ❌ | Rütbe Bronze→Diamond, kilometre taşı rozetleri, gizlilikli liderlik tablosu, rütbe-atlama kutlaması (push+confetti) |
| **Account** | ❌ | Profil, banka/ödeme profili (KYC), bildirim tercihleri, 2FA, dil/tema, hesabı kapat |
| **Notifications** | ❌ | Uygulama-içi bildirim merkezi (zil + okundu) |

---

## 4. Tenant admin — modül modül

### Dashboard 🟡
KPI kartları (sparkline+trend), **global zaman aralığı** (Bugün/7g/30g/Ay/Çeyrek/YTD/Özel),
**dönem karşılaştırma** (delta rozetleri), ciro+komisyon **stacked-area** zaman serisi (önceki dönem
hayalet çizgisi), **funnel** (Invite→Signup→First Sale→Matured), Top Performer tablosu, cohort, **Export**.

### Sales 🟡
Gelişmiş **FilterBar** (durum/tarih/satıcı/tutar-aralığı) + **Saved Views** + checkbox **bulk** (toplu
onay/void) + **detay drawer** (satıcı + ağaç konumu + **komisyon dağılım listesi** + durum timeline) +
**CSV import sihirbazı** (yükle→eşleştir→önizle→hata haritası→onayla) + inline düzenleme + sayfalama/sıralama.
Butonlar: New sale · Import · Bulk approve · Bulk void · Export · Saved view · Filter.

### Members 🟡 → CRM
Zengin tablo (avatar/rol/durum/ekip-boyutu/kazanç) + filtre + **profil drawer** (Genel/Sales/Ledger/Invites/Audit)
+ **toplu davet** (çoklu e-posta) + toplu rol/durum + CSV export. Butonlar: Invite · Bulk invite · Change role ·
Deactivate · Message · Export · Filter.

### Network (ağaç) ❌ — ÖNCELİKLİ YENİDEN TASARIM
Girintili liste → **react-flow interaktif org-chart**: auto-layout (dagre/ELK), pan/zoom, MiniMap,
**ara→düğüme uç+highlight**, rol/durum/derinlik filtresi, lazy-expand (büyük ağaç), düğüm detay yan-paneli,
sponsor breadcrumb, **PNG/SVG export**, "liste/tablo" erişilebilir alternatif toggle. (Radial varyant da seçenek.)

### Payouts 🟡
Dönem seçici + payable tabloda **checkbox seçimli toplu ödeme** + banka CSV **preset'leri** (SEPA/havale) +
**payout talep kuyruğu** (Approve/Reject + sebep) + detay drawer (dahil ledger satırları) +
**negatif-bakiye uyarı bandı** (mahsup) + **vergi (1099) yıllık özeti** + export.

### Audit 🟡
Filtrelenebilir zaman çizelgesi (aktör/entity/aksiyon/tarih/arama) + **insan-okur başlık** + **before/after
diff** + para-aksiyon filtresi + relatif zaman + entity→kayıt deep-link + **export**. *(before alanı +
aktör join backend'e eklenecek.)*

### Reports ❌ — YENİ
Komisyon / Vergi (1099) / Top-Performer / **Ağaç Sağlığı** (pasif oran, derinlik dağılımı, yetim düğüm) /
Dönem-Kapanış — her biri grafik + tablo + **export (CSV/PDF)** + zamanlanmış-email.

### Settings Center ❌ — boş form yerine kategori-navigasyonlu merkez
- **General** (işletme adı, timezone, currency, locale)
- **Brand / White-label** — logo (light/dark/favicon), renk picker (WCAG AA uyarı), **canlı önizleme**, custom domain, "Powered by Refearn" toggle
- **Commission plan editor + simulator** — görsel seviye/oran editörü (slider), SUM≤pool canlı doğrulama, **canlı ağaç simülatörü** ("1000 satış simüle et"), plan versiyonlama, şablonlar
- **Payments** — olgunlaşma kuralı, payout eşiği, dönem, banka CSV şablonu
- **People & Roles** — RBAC izin matrisi, davet politikası, SoD
- **Security** — 2FA zorunluluğu, oturum politikası, IP allowlist (Enterprise), parola politikası
- **Developer** — API keys, **webhooks** (olay aboneliği + teslimat logu + retry + imza secreti), entegrasyonlar (Zapier/Make/Slack/Monday CRM)
- **Notifications** — olay × kanal matrisi (aşağı)
- **Localization** — UI dili (EN/TR…), tarih/sayı/para formatı
- **Billing** — abonelik planı, kullanım, fatura geçmişi
- **Data & Backup** — export (GDPR/KVKK), yedek durumu + manuel tetik, saklama politikası, tenant silme

---

## 5. Platform admin (SaaS sahibi) ❌ — YENİ yüzey
Tenant listesi (plan/MRR/aktif-üye/sağlık) + tenant detay (kullanım+fatura+log) + güvenli
**impersonation** (audit'li + "Viewing as X — exit" bandı) + per-tenant limit/feature-flag + global sağlık
panosu (hata oranı, gecikmiş payout, webhook hatası) + paket matrisi (Starter/Growth/Enterprise) + onboarding.

---

## 6. Email sistemi
**Mevcut:** outbox relay → SMTP/console + Expo push ✅, şablonlar (TR) 🟡.
**Eklenecek:** EN+marka-uyumlu HTML şablonlar, **deliverability** (SPF/DKIM/DMARC rehberi), bounce/complaint
yönetimi, sağlayıcı soyutlama (SMTP/SES/Postmark), gönderim logu + retry (✅), unsubscribe (pazarlama),
test-gönder. Akışlar: verify-email, password-reset, commission-earned, payout-sent, team-joined,
security-alert, payout-request, digest.

## 7. Notifications
**Mevcut:** outbox + push/email kanalları ✅.
**Eklenecek:** **olay × kanal matrisi** (E-posta/Uygulama-içi/Push/Slack-webhook) — grid toggle; kişisel +
tenant-varsayılan iki katman; **digest** (anında/günlük/haftalık) + sessiz saatler; **uygulama-içi bildirim
merkezi** (zil + okundu + tıkla-git); test bildirimi.

## 8. Invite (davet) — iki taraf
Markalı luxury kart (QR+avatar+kod) + sosyal paylaşım + **durum takibi** (`Invite.openedAt` eklenir:
Pending/Opened/Joined) + **funnel** (gönderildi→açıldı→kayıt→ilk satış, dönüşüm %) + admin davet
leaderboard + e-postaya-kilitli davet + hoşgeldin/onboarding akışı + **davet cap** (✅ sybil önleme).

---

## 9. Güvenlik operasyonu — önleme / tespit / müdahale

**Önleme:** helmet+Caddy başlıkları ✅, rate-limit ✅, trust-proxy ✅, secret fail-fast ✅, SoD ✅,
e-posta kapısı ✅, davet cap ✅. Eklenecek: 2FA, RLS, parola politikası, **bağımlılık taraması (CI'da
`pnpm audit` + Dependabot)** ❌, CSV formula-injection nötrleme ❌, helmet CSP ince ayar.

**Tespit:** güvenlik olay logu (login_failed/refresh_reuse/authz_denied) ✅. Eklenecek: **anomali/alarm**
(anormal payout, ani ağaç büyümesi, self-sale, aynı IP'den N kayıt, payout-profili-değişip-hızlı-payout),
**Sentry** + merkezi log + alert kanalı (Slack/e-posta), uptime izleme, kuyruk derinliği metriği.

**Müdahale:** **kill-switch uçları** ❌ (tenant suspend + üye suspend → ilgili refresh token'ları toptan
iptal + audit), payout dondurma, incident-response runbook ✅(DR), güvenlik bildirimi (uyeye/admine).

## 10. Audit & log yaşam döngüsü (şişme önleme)
**Mevcut:** para/rol/plan/ayar/güvenlik aksiyonları audit ✅.
**Eklenecek:**
- **before/after diff** + aktör join + filtre + export.
- **Audit retention cron** ❌ — `audit_logs`'u N gün (örn. 90) sıcak tablo, eskiyi **sıkıştırıp offsite'e
  (Drive) arşivle + sıcak tablodan sil** (şişmeyi önler, yasal saklamayı korur). Aynı mantık
  `notifications` (sent > X gün) için.
- Partisyonlama (büyük tenant'ta `audit_logs` aylık partition) — ileri ölçek.

## 11. Yedek & felaket kurtarma
**Mevcut:** günlük pg_dump + atomik + age şifreleme + **Google Drive offsite** (rclone) + restore-test +
30 gün retention + alarm hook ✅. **Eklenecek:** secrets'ın ayrı şifreli kopyası, haftalık restore-test
cron'u, RPO/RTO yazılı hedef, (ileri) PITR/WAL arşivleme.

## 12. Gözlemlenebilirlik
**Mevcut:** /healthz ✅. **Eklenecek:** yapılandırılmış JSON log (pino), Sentry, /metrics (Prometheus),
kuyruk/cron metrikleri, alerting, uptime, log rotation.

## 13. Faturalama & abonelik (SaaS) ❌
Tenant'ın kendi Refearn aboneliği: plan kartı + kullanım progress-bar (limit uyarısı) + upgrade/downgrade +
ödeme yöntemi + fatura geçmişi (PDF) + vergi. Platform tarafıyla simetrik.

## 14. Veri & uyumluluk
GDPR/KVKK export+silme, veri saklama, **1099-NEC + TIN toplama** (>$600), **FTC income-disclosure** (MLM
yasal zorunluluğu), gizlilik/şartlar/DPA, money-transmitter hukuki görüş.

---

## 15. Zamanlanmış işler envanteri (cron/queue)
| Job | Durum | Aralık |
|---|---|---|
| matureCommissions | ✅ | 5 dk |
| notification relay | ✅ | 10 sn |
| daily backup (+offsite Drive) | ✅ | 24 sa |
| **audit/notification retention-archive** | ❌ | gece |
| **team_stats snapshot** | ❌ | gece |
| **restore-test** | 🟡 (script var) | hafta |
| **anomaly/fraud scan** | ❌ | saatlik |
| 1099 yıl-sonu derleme | ❌ | yıllık |

---

## 16. İnşa fazları (öneri)
- **Faz A** — Tasarım sistemi + tema + i18n (devam ediyor) + **Network ağaç (react-flow)** öne çekilir.
- **Faz B** — Admin operasyon zenginleştirme (Dashboard/Sales/Members/Payouts/Audit/Reports).
- **Faz C** — Üye + Invite funnel + Team + Gamification + Account.
- **Faz D** — Settings Center + Brand/White-label + Plan editor + Security(2FA/RLS) + Platform admin + Notifications matrisi + Billing + ops (Sentry/retention cron/anomaly).
