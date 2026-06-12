# Refearn — Luxury Redesign Vizyonu

> Mevcut "jenerik mor-dark dashboard" terk edilir. Hedef: referans işini **satacak** kadar
> premium bir B2B fintech SaaS. Light + Dark, tamamen İngilizce, modül-modül zengin.

## 1. Tasarım Dili Kararı — "Obsidian & Champagne"

Tek-mor (#7c8bff) gradient + glassmorphism **tamamen bırakılır.** Yerine **monokrom-lüks +
tek metalik altın aksan**: derin nötr-soğuk obsidyen yüzeyler üzerine sıcak şampanya altını.
Altın yalnızca **"değer anlatan" yerde** — CTA, aktif nav, premium rozet, para vurgusu. Az ve değerli.

**Materyal:** cam bulanıklığı (glassmorphism) yerine Linear/Stripe materyali — net yüzey + 1px
hairline border + çok-katmanlı yumuşak gölge + çok hafif grain. Derinlik renkle (yüzey katmanı),
gölgeyle değil. Dark'ta "light-from-top" üst-kenar aydınlatması.

**İki tam tema** (`data-theme="light|dark"`, FOUC'suz init, localStorage + prefers-color-scheme).
İki katmanlı token: ham palet → semantik token. Bileşen asla ham hex kullanmaz (= white-label temeli).

### Ana token'lar
```
/* Marka — şampanya altını rampası */
--gold-200 #F0DCA8  --gold-400 #E4C266  --gold-500 #D4AF37 (marka)  --gold-600 #B8922E  --gold-800 #6B5414
/* Obsidyen yüzey rampası (nötr-soğuk) */
--ink-950 #0A0B0F … --ink-800 #1D212C … --ink-300 #9AA1B4 … --ink-50 #F4F6FB
/* Semantik (dark/light) */
--surface-base/1/2/3   --text (#E8EBF2 / #14161D)   --brand #D4AF37
/* PARA semantiği (kritik) */
--money-positive #1D9E75   --money-pending #BA7517   --money-negative #D85A30 (coral, kırmızı değil)
/* İkincil jewel aksan (link/info) */
--sapphire #3E63DD
/* Data-viz 8 kategorik + MLM derinlik için sequential altın→bakır 5-stop */
```

**Tipografi:** Display (Satoshi/Geist) + Text (Inter) + Mono (Geist Mono). **Tüm para/metrik =
tabular-nums** (zorunlu). **İkonografi:** emoji-glif → **Lucide** (1.5px stroke). **Hareket:**
spring + count-up + stagger fade + skeleton; `prefers-reduced-motion` korunur. **Marka isareti:**
ağdan türetilen monogram **R** + tek altın düğüm.

İlham: Mercury · Ramp · Stripe · Linear · Vercel/Geist.

## 2. Görsel Yönler (müşteri seçimi)

| Yön | Palet | His |
|---|---|---|
| **Obsidian & Champagne** ⭐ | Obsidyen yüzey + şampanya altın + sapphire | Mercury/Ramp sıcaklığı + Stripe disiplini; altın = "değer/ödül". Sakin, pahalı, güvenilir |
| **Porcelain & Ink** | Light-öncelikli porselen/krem + mürekkep-siyah + zarif altın | Editoryal, ferah, "private banking / luxury brand"; Oppein estetiğine yakın |
| **Onyx & Emerald** | Obsidyen + ikili aksan: zümrüt (kazanç) + altın (ödül) | Enerjik, "büyüme/fintech challenger"; gamification & trendler canlı |

## 3. Modül-modül yeni hâl + en kritik özellikler

**Tasarım Sistemi + Tema + i18n (çapraz temel):** tokens.css tek-kaynak (light/dark), ThemeProvider,
Lucide, EN-varsayılan `{en,tr}` i18n, paylaşılan **DataTable / Drawer / FilterBar / SavedViews / Chart**.

**Dashboard:** global zaman aralığı + dönem karşılaştırma; sparkline-gömülü KPI'lar; geniş stacked-area
zaman serisi (önceki dönem hayalet çizgisi); Top Performer; funnel (Davet→Kayıt→İlk Satış→Olgun); cohort; export.

**Satışlar:** gelişmiş FilterBar + **Saved Views** + checkbox **bulk** (toplu onay/void) + komisyon-dağılımlı
**detay drawer** + **CSV import sihirbazı** (yükle→eşleştir→önizle→hata haritası→onayla).

**Üyeler:** CRM-benzeri zengin tablo (avatar/rol/durum/ekip-boyutu/kazanç) + sekmeli **profil drawer**
(Genel/Satışlar/Ledger/Davetler/Audit) + toplu davet + toplu işlem.

**Ödemeler:** dönem seçici + **seçimli toplu ödeme** + banka CSV preset'leri (SEPA/havale) + **payout talep
kuyruğu** (approve/reject) + negatif-bakiye uyarı bandı + vergi (1099) özeti.

**Denetim:** filtrelenebilir zaman çizelgesi + insan-okur başlık + **before/after diff** + para-aksiyon filtresi.

**Raporlar (YENİ):** Komisyon / Vergi / Top-Performer / Ağaç-Sağlığı / Dönem-Kapanış — grafik + tablo + export.

**Ağaç (YENİ hâl):** girintili liste → **react-flow interaktif org-chart** (auto-layout, MiniMap, pan/zoom,
ara→düğüme uç+highlight, lazy-expand, PNG/SVG export). Üye tarafında **gizlilik-korumalı radial "My Network"**
(merkez "You", L1 isimli, L2+ agregat balon).

**Davet (mükemmel, iki taraf):** markalı **luxury davet kartı** (QR+avatar+kod, PNG export) + sosyal paylaşım
(WhatsApp/Telegram/Email/X) + **durum takibi** (Pending/Opened/Joined) + **funnel** (gönderildi→açıldı→kayıt) +
admin davet leaderboard + hoşgeldin onboarding akışı.

**Ekip Analitiği:** üye KPI şeridi + 12-haftalık büyüme trendi + gizlilikli yeni-katılım activity feed +
rütbe ilerleme; admin alt-ağaç performans drill-down.

**Gamification (YENİ):** rütbe Bronze→Diamond + kilometre taşı rozetleri + gizlilikli liderlik tablosu +
rütbe-atlama kutlaması (push + confetti).

**Cüzdan:** kazanç trend grafiği + seviye-kaynak dağılım donut + **pending→payable vade takvimi** (maturesAt
zaten var) + payout durum timeline + PDF ekstre.

**Ayarlar Merkezi (boş→dolu):** sol kategori nav + route-bazlı + sticky "unsaved changes" guard. Bölümler:
General / **Brand (white-label)** / **Commission Plan Editor + Simulator** / Payments / Localization /
**Notifications matrisi** / **Security (2FA, oturum, API key)** / **Team & Roles (RBAC)** / Developer (webhooks) / Billing.

**Brand & White-label Studyosu (YENİ):** logo (light/dark/favicon) + renk picker (WCAG AA uyarı) + **canlı
önizleme** (login/üye-kart/davet anlık render) + custom domain + "Powered by Refearn" toggle. *Ürünü satılabilir
yapan kritik bölüm — `tenant.branding` alanı zaten var, UI yok.*

**Komisyon Plan Editörü + Simülatör (YENİ):** görsel seviye/oran editörü (slider) + SUM≤pool canlı doğrulama +
**canlı ağaç simülatörü** ("1000 satış simüle et" → dağıtım istatistikleri) + plan versiyonlama + şablonlar.

**Platform Admin (YENİ yüzey):** tenant listesi (plan/MRR/sağlık) + güvenli **impersonation** + per-tenant
limit/feature-flag + global sağlık panosu + paket matrisi.

**Global UX:** **Cmd+K komut paleti** + global arama + **bildirim merkezi/zil** + tenant switcher + onboarding
checklist + tutarlı empty-state + klavye kısayolları.

## 4. Faz Planı

| Faz | Kapsam | Efor |
|---|---|---|
| **A — Tasarım Sistemi + Tema + i18n** | tokens (light/dark), ThemeProvider, Lucide, EN-varsayılan i18n, paylaşılan DataTable/Drawer/FilterBar/Chart. **Diğer her şeyin temeli.** | ~2-3 hafta |
| **B — Admin Operasyon** | Dashboard, Sales, Members, Payouts, Audit, Reports (yeni) | ~4-6 hafta |
| **C — Üye + Ağaç + Davet + Gamification** | react-flow ağaç, radial network, luxury davet+funnel, ekip analitiği, cüzdan, rütbe | ~4-5 hafta |
| **D — Platform + Ayarlar + Plan Editörü + White-label** | Settings Center, Brand studio, plan editörü+simülatör, platform admin, Cmd+K | ~5-7 hafta |

> Efor solo-ajan hızında değil takım tahminidir; ben fazları sıralı, test-li commit'lerle teslim ederim.
