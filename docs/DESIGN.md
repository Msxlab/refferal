# Refearn Tasarım Sistemi

Tek kaynak: `apps/web/src/app/globals.css` (token + temel sınıflar) ve
`apps/web/src/components/ui.tsx` (React bileşenleri). Bu doküman ikisinin sözleşmesidir.

Kimlik: **koyu fintech** — gradient mesh arka plan, cam (glassmorphism) kartlar,
gradient vurgular, sayısal animasyonlar. "Etkileyici ama anlatıcı": her görsel öğe
bir veriyi açıklar, süs için efekt kullanılmaz.

---

## 1. Design Token'ları (`:root`)

| Grup | Token'lar | Not |
|---|---|---|
| Zemin | `--bg-0/1`, `--panel`, `--panel-solid`, `--panel-2` | Kartlar `--panel` + blur |
| Çizgi | `--border`, `--border-strong` | 1px hairline |
| Metin | `--text`, `--muted`, `--faint` | 3 kademeli hiyerarşi |
| Marka | `--primary`, `--primary-2`, `--grad-primary` | Mor-mavi gradient |
| Semantik | `--emerald`(başarı/para), `--amber`(bekleyen), `--rose`(tehlike), `--sky`(bilgi) + `--grad-*` | Badge/grafik renkleri |
| Gölge | `--shadow-lg`, `--shadow-glow` | Glow yalnız vurgu kartında |
| Yarıçap | `--radius`(18), `--radius-sm`(12) | |
| **Boşluk** | `--space-1..8` (4/8/12/16/20/24/32) | 4px taban |
| **Tipografi** | `--text-xs..hero` (11→42) | |
| **Hareket** | `--dur-fast/base/slow`, `--ease-out/spring` | |
| **Odak** | `--focus-ring` | a11y halkası |

**Kural:** Yeni kodda renk/boşluk/font boyutu **token'dan** gelir. Inline `style` yalnız
yerleşim mikro-ayarı (flex/width) için kabul edilir; sabit hex/rgb yazılmaz.

## 2. CSS Sınıfları (temel yapı taşları)

- **Buton** `.btn` — varyant: `.ghost` `.danger` `.success`; boyut: `.sm`; genişlik: `.block`.
  Durumlar: hover(kalkış+shimmer), active, `:disabled`, `:focus-visible`(halka).
  Meşgul durum: `disabled + metin değişimi` deseni (`{busy ? '...' : '...'}`).
- **Kart** `.card` — `.hover`(kalkış), `.card-glow`(gradient çerçeve), `.hero`(vurgu/bignum).
- **Rozet** `.badge` — durum sınıfı **API enum adıyla birebir**: `draft/approved/void/active/
  inactive/pending/payable/paid/reversed/requested/processing/failed/used/expired/revoked`.
- **Kabuklar** — admin: `.shell > .side + .main` (sidebar); üye: `.topbar + .appmain` (üst-nav).
- **Yardımcılar** — `.muted .faint .row .spread .grid .h1 .sub .eyebrow .gradient-text
  .tnum .center .error .skeleton .fade-in .delay-1/2/3`.
- **Geri bildirim** — `.toast` (her zaman `role="status"` ile), `.modal-backdrop + .modal`.

## 3. React Bileşenleri (`components/ui.tsx`)

| Bileşen | Görev | a11y |
|---|---|---|
| `MoneyCounter` / `CountUp` | Animasyonlu para/sayı (cent string alır) | `tnum` hizalı |
| `Donut` | SVG halka grafik (+`center` slot) | `role="img"` + yüzde özetli `aria-label` |
| `Bars` | Yatay bar listesi | `role="list/listitem"` + değer etiketli |
| `StatCard` | İkonlu metrik kartı (grad + hint + delay) | — |
| `Modal` | Diyalog kabuğu | `role="dialog"` `aria-modal`, **ESC kapatır**, açılışta odak |
| `Confirm` | Para/geri-alınamaz aksiyon onayı | Modal üzerine kurulu; `danger` varyantı |
| `Toggle` | Anahtar (ayarlar) | `role="switch"` `aria-checked`, klavye |
| `Brand` | Logo+isim (`md/lg`) | — |
| `Loading` | Skeleton satırlar | `role="status"` |
| `useToast` | 2.8s otomatik kapanan bildirim | render: `<div className="toast" role="status">` |

## 4. Desenler

- **Para aksiyonu = Confirm** — approve/void/payout-run asla tek tıkla çalışmaz.
- **Sayfa girişi** — `.eyebrow` (bağlam) → `.h1` (başlık) → `.sub` (tek cümle açıklama);
  kartlar `fade-in delay-1/2/3` ile kademeli gelir.
- **Veri durumları** — yükleniyor: `<Loading/>`; boş: `.muted` satır; hata: `.error`.
- **Para gösterimi** — daima `lib/format.money(cents)` (string cent → $) + `.tnum`.

## 5. Erişilebilirlik taban çizgisi

- Klavye odağı: global `:focus-visible` halkası (`--focus-ring`).
- `prefers-reduced-motion: reduce` → tüm animasyon/geçişler kapanır.
- Grafikler ekran okuyucuya metinle anlatılır (Donut/Bars aria).
- Modal: ESC + odak yönetimi; toast/loading: `role="status"`.

## 6. Yapılacaklar (bilinçli açık)

- Sayfalardaki mevcut inline `style` yoğunluğu (~140 kullanım) kademeli olarak token/sınıfa
  taşınacak — yeni kod için kural şimdiden geçerli.
- EN sözlüğü (i18n şu an yalnız TR), kontrast denetimi (WCAG AA), tablo→kart mobil dönüşümü.
- Mobil (Expo) aynı token setini `theme.ts` olarak paylaşacak.
