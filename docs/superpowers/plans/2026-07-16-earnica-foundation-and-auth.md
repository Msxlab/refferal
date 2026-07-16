# Earnica Foundation and Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerçek Earnica marka varlıklarını, Obsidian + Pearl semantic design system'i, shadcn tabanlı ortak composition katmanını ve bütün public/auth güven akışlarını premium, responsive ve erişilebilir biçimde kurmak.

**Architecture:** Marka asset'leri uygulamadan bağımsız source-of-truth olur. Tailwind v4 semantic CSS variables primitive'leri besler; route'lar doğrudan renk/radius üretmez. `EarnicaShell`, `PageContext`, `StatePanel`, `DecisionWorkspace` ve finansal presentation helper'ları member/admin/HQ planlarının ortak bağımlılığıdır. Auth route'ları tek `AuthShell` ve explicit state machine'ler kullanır.

**Tech Stack:** Next.js 15, React 19, Tailwind CSS 4, shadcn/Radix, Lucide, qrcode.react, CSS motion, local image generation/export tooling.

## Global Constraints

- Master ve P0 planlarının constraints/authority kararları geçerlidir.
- Yeni npm/pnpm dependency eklenmez; `package.json` ve `pnpm-lock.yaml` değiştirilmez.
- Marka işareti CSS/JSX/div/inline SVG ile çizilmez. ImageGen veya onaylı tasarım export'u gerçek asset üretir.
- SVG kaynak path-based ve gerçek vector export olmalıdır. Otomatik vector export imkânı yoksa asset gate durur; embedded raster veya elle yazılmış yaklaşık SVG kabul edilmez.
- Auth/session internal storage key'leri korunur; access token localStorage ve refresh HttpOnly cookie sözleşmesi bozulmaz.
- Varsayılan görünüm pearl canvas + ink navigation'dır; mevcut dark theme kullanıcı tercihi korunur.

---

## Task FA-01: Gerçek Earnica Source Artwork'ünü Üret ve Görsel Olarak Onayla

**Files:**

- Create: `apps/web/public/brand/earnica-mark-source.png`
- Create: `apps/web/public/brand/earnica-wordmark-source.png`
- Create: `apps/web/public/brand/earnica-mark.svg`
- Create: `apps/web/public/brand/earnica-wordmark.svg`
- Create: `apps/web/public/brand/earnica-wordmark-inverse.svg`

- [ ] `imagegen` skill'ini oku ve source asset oluşturma için kullan; approved `docs/superpowers/specs/assets/earnica-operations-workspace-reference.png` görüntüsünü görsel grounding olarak aynı generation input'una dahil et.
- [ ] Slot ölçülerini sabitle: mark square, wordmark 4:1; clear space en az mark height `0.5×`.
- [ ] Prompt: “lowercase earnica; custom monoline e begins as a ledger trace and ends in a verification notch; sober professional fintech operations brand; flat one-color ink; no gradients, glow, coin, dollar sign, network cliché, mockup, background, tagline or extra text; exact spelling earnica; high-contrast vector-like source”.
- [ ] Mark ve wordmark source rasterlarını ayrı üret; görüntüleri visual inspection ile exact spelling, trace/notch, small-size silhouette ve no-artifact açısından kontrol et.
- [ ] ImageGen source raster'ı yalnız yön/onay girdisi olarak kullan. Path-based SVG'yi ancak user-approved gerçek vector/design export aracı veya kullanıcı tarafından sağlanan designer source ile üret; local Inkscape/potrace/ImageMagick bulunmadığı için özel tracer yazma ve elle path çizme.
- [ ] Approved vector export aracı/source sağlanmazsa SVG gate'ini `BLOCKED: approved-vector-source-unavailable` olarak raporla; rasterı SVG içine embed ederek veya yaklaşık artwork ile task'ı geçme.
- [ ] SVG'lerde `viewBox`, path artwork, gereksiz metadata olmaması ve inverse varyantın yalnız renk farkı taşıması kontrollerini yap.
- [ ] Mark'ı 20 px, wordmark'ı 96 px minimum kullanımda pearl/ink zeminlerde yan yana görüntüle.
- [ ] Görsel gate geçmiyorsa yeniden ImageGen üret; yaklaşık asset'i uygulamaya sokma.
- [ ] `git diff --check -- apps/web/public/brand` ve exact asset listesi kontrolü.
- [ ] Commit: `feat: add Earnica source brand artwork`.

## Task FA-02: Web Icon ve PWA Export Setini Üret

**Files:**

- Create: `apps/web/src/scripts/export-brand-assets.py`
- Create: `apps/web/public/favicon.ico`
- Create: `apps/web/public/brand/favicon-32.png`
- Create: `apps/web/public/apple-touch-icon.png`
- Create: `apps/web/public/brand/pwa-192.png`

- [ ] Export script testini script içinde fail-fast dimension/assertion olarak yaz: transparent favicon, opaque 180 icon, exact dimensions.
- [ ] Scripti kaynak mark PNG'den Pillow ile crop-safe, centered export yapacak şekilde yaz; artwork safe zone'u `0.66×` aşmasın. Doğrulanmış runtime: `C:\Users\Windows\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe` + Pillow 12.2.0; global `python` varsayma.
- [ ] Önce kaynak dosya yokken scripti çalıştırıp anlaşılır FAIL üretmesini doğrula.
- [ ] Source asset ile scripti çalıştır; multi-size ICO 16/32/48, PNG 32, 180 ve 192 üret.
- [ ] `C:\Users\Windows\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe apps/web/src/scripts/export-brand-assets.py --verify`; PASS bekle.
- [ ] 16/20/32 px renderları görsel olarak incele; notch kayboluyorsa source/scale'i düzelt.
- [ ] Commit: `build: export Earnica web icons`.

## Task FA-03: Büyük Marka Exportlarını ve Metadata Görsellerini Üret

**Files:**

- Modify: `apps/web/src/scripts/export-brand-assets.py`
- Create: `apps/web/public/brand/pwa-512.png`
- Create: `apps/web/public/brand/og-earnica.png`
- Create: `apps/web/public/brand/email-wordmark.png`
- Create: `apps/web/public/brand/earnica-mark-monochrome.png`

- [ ] Script dimension testine 512×512, 1200×630, 640×160 ve monochrome alpha kurallarını ekle; mevcut script FAIL bekle.
- [ ] OG yüzeyini pearl/ink/cobalt ile, gerçek wordmark ve `by Americana Studio` endorsement kullanarak üret; sahte dashboard screenshot ekleme.
- [ ] Email wordmark 640×160 source ve monochrome fallback'i üret.
- [ ] Script verify modunu çalıştır; tüm dimension/opaque/alpha kontrolleri PASS bekle.
- [ ] OG 1200×630 ve email 320×80 render preview'larını görsel incele.
- [ ] Commit: `build: export Earnica social and email assets`.

## Task FA-04: Earnica Marka Runtime Contract'ını Kur

**Files:**

- Modify: `apps/web/src/lib/brand.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/components/ui.tsx`
- Create: `apps/web/src/lib/brand.contract.node.test.ts`

**Target contract:**

```ts
export const EARNICA_BRAND = {
  productName: 'Earnica',
  wordmark: 'earnica',
  endorsement: 'by Americana Studio',
  assetVersion: 'earnica-v1',
  markSrc: '/brand/earnica-mark.svg?v=earnica-v1',
  wordmarkSrc: '/brand/earnica-wordmark.svg?v=earnica-v1',
} as const;

export const BRAND_ASSET_VERSION = EARNICA_BRAND.assetVersion;

export type RuntimeBrand = {
  name: string;
  monogram: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
};

export type EarnicaBrandContext = {
  product: typeof EARNICA_BRAND;
  tenant: {
    displayName: string;
    monogram: string;
    tagline: string;
    primaryColor: string;
    accentColor: string;
  } | null;
};
```

- [ ] Source contract testinde default user-visible name, versioned wordmark paths, `BRAND_ASSET_VERSION`, endorsement, metadata/icon/OG paths, additive `EarnicaBrandContext` ve old visible asset absence beklentilerini yaz.
- [ ] Testi çalıştır; old Americana Earn/refearn asset nedeniyle FAIL bekle.
- [ ] Existing `RuntimeBrand`, `DEFAULT_RUNTIME_BRAND`, `normalizeRuntimeBrand()` shape'ini geriye uyumlu tut; API'nin `name/monogram/tagline/primaryColor/accentColor` response'unu kırma. Additive `toEarnicaBrandContext()` adapter'ı product ve tenant katmanını ayırsın.
- [ ] Earnica ürün markası ile tenant context'ini ayır; tenant product wordmark'i replace edemesin ve tenant colors yalnız allowlisted context/preview alanında kalsın.
- [ ] `Brand` component'ini gerçek asset, accessible standalone label ve one-per-session 480 ms reveal ile güncelle.
- [ ] `sessionStorage` reveal key'i auth session'a bağlama; reduced-motion'da statik render et.
- [ ] Root metadata title/description/icons/openGraph'i Earnica'ya bağla.
- [ ] Source dosya adlarını spec ile sabit tut; uygulama URL'lerini `BRAND_ASSET_VERSION` query/hash contract'ıyla cache-bust et ve asset değişiminde version artırılmasını testle.
- [ ] Test ve `pnpm.cmd --filter @refearn/web lint --incremental false`; PASS bekle.
- [ ] Commit: `feat: establish Earnica runtime brand contract`.

## Task FA-05: Obsidian + Pearl Semantic Token Sistemini Uygula

**Files:**

- Modify: `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/layout.tsx`
- Create: `apps/web/src/app/theme.contract.node.test.ts`

- [ ] Contract testte spec'teki light/dark semantic aliases, motion durationları, 44px touch target, focus-visible ve reduced-motion kurallarını ara; FAIL bekle.
- [ ] Raw palette (`ink/pearl/cobalt/amber/mint/rose`) ve semantic aliases (`canvas/surface/text/border/action/focus/selected/disabled`) tanımla.
- [ ] Varsayılanı light pearl yap; mevcut `refearn.theme` preference varsa dark/light seçimini koru.
- [ ] 4px spacing, 8–12px radius, hairline border ve yalnız overlay shadow seviyesini tanımla.
- [ ] Motion tokens: 140/200/280/480/720 ms; transform/opacity dışı layout motion ekleme.
- [ ] Existing skip-link, landmark, focus ve reduced-motion güvenliklerini koru.
- [ ] Contract test + web typecheck çalıştır; PASS bekle.
- [ ] Commit: `feat: add Earnica semantic design tokens`.

## Task FA-06: Eksik shadcn/Radix Overlay Primitive'lerini Normalize Et

**Files:**

- Create: `apps/web/src/components/ui/dialog.tsx`
- Create: `apps/web/src/components/ui/sheet.tsx`
- Create: `apps/web/src/components/ui/dropdown-menu.tsx`
- Create: `apps/web/src/components/ui/tooltip.tsx`
- Create: `apps/web/src/components/ui/overlay-primitives.contract.node.test.ts`

- [ ] Contract testte Radix primitives, portal, title/description, close, focus trap/return ve reduced-motion class'larını yaz; FAIL bekle.
- [ ] Mevcut `radix-ui` dependency'sinden Dialog/Sheet/Dropdown/Tooltip wrapper'larını oluştur; package add çalıştırma.
- [ ] Sheet desktop dock/mobile full-width variants'i compound composition ile sağlasın; boolean prop çoğaltma.
- [ ] Icon-only close düğmeleri `aria-label` ve minimum 44px target taşısın.
- [ ] Contract test + web typecheck; PASS bekle.
- [ ] Commit: `feat: normalize Earnica overlay primitives`.

## Task FA-07: Command ve Async State Primitive'lerini Ekle

**Files:**

- Create: `apps/web/src/components/ui/command.tsx`
- Create: `apps/web/src/components/product/PageContext.tsx`
- Create: `apps/web/src/components/product/StatePanel.tsx`
- Create: `apps/web/src/components/product/EmptyState.tsx`
- Create: `apps/web/src/components/product/product-primitives.contract.node.test.ts`

- [ ] Contract testte semantic heading, loading skeleton, empty action, retry/error live region ve command keyboard modelini yaz; FAIL bekle.
- [ ] Command'i Radix mevcut primitives + native combobox/listbox semantics ile oluştur; dependency ekleme.
- [ ] `PageContext` tek H1, eyebrow/context, actions ve breadcrumbs slot'ları kullansın.
- [ ] `StatePanel` loading/error/stale/refreshing/empty durumlarını explicit components olarak compose etsin.
- [ ] Error mesajlarını generic “Something went wrong” ile sınırlama; safe error + retry action ver.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica page and async-state primitives`.

## Task FA-08: Finansal Presentation Primitive'lerini BigInt-Safe Yap

**Files:**

- Modify: `apps/web/src/lib/format.ts`
- Create: `apps/web/src/lib/payout-presentation.ts`
- Create: `apps/web/src/components/product/FinancialValue.tsx`
- Create: `apps/web/src/components/product/StatusBadge.tsx`
- Create: `apps/web/src/lib/financial-presentation.contract.node.test.ts`

**Contract:**

```ts
type MoneyValue = { amountCents: string; currency: string };
type FinancialValueProps = MoneyValue & {
  emphasis?: 'default' | 'earned' | 'muted';
  showCode?: boolean;
};
```

- [ ] MAX_SAFE_INTEGER üstü positive/negative cent string, invalid currency, currency grouping ve unknown payout event testlerini yaz; FAIL bekle.
- [ ] `Number(cents)` kullanan MoneyCounter path'ini financial surface'lerde kaldır; BigInt/string formatter kullan.
- [ ] Payout presentation mapper yalnız P0 canonical state'leri döndürsün; unknown event `status-unavailable` olsun.
- [ ] `FinancialValue` tabular, right-aligned, currency-visible ve animation-independent state taşısın.
- [ ] `StatusBadge` color + Lucide icon + text ile anlam taşısın.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `fix: make Earnica financial presentation exact`.

## Task FA-09: Ortak Earnica Shell Composition'ını Kur

**Files:**

- Create: `apps/web/src/components/shell/EarnicaShell.tsx`
- Create: `apps/web/src/components/shell/ShellNavigation.tsx`
- Create: `apps/web/src/components/shell/ShellContextSwitcher.tsx`
- Modify: `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/shell/EarnicaShell.contract.node.test.ts`

**Compound API:**

```tsx
<EarnicaShell.Root>
  <EarnicaShell.Navigation>{...}</EarnicaShell.Navigation>
  <EarnicaShell.Header>{...}</EarnicaShell.Header>
  <EarnicaShell.Main>{children}</EarnicaShell.Main>
  <EarnicaShell.Aside>{optionalInspector}</EarnicaShell.Aside>
</EarnicaShell.Root>
```

- [ ] Contract testte skip link, header/nav/main/aside landmarks, one H1 delegation, desktop rail, mobile navigation ve safe-area rules yaz; FAIL bekle.
- [ ] Shell'i role/content agnostic compound component yap; member/admin/HQ wrappers children ile compose etsin.
- [ ] Breakpoints: 767/768, 1023/1024, 1279/1280, 1439/1440 sınırlarını CSS'te açık tanımla.
- [ ] 320/390 px'de page horizontal overflow üretmeyen min-width/overflow kuralı ekle.
- [ ] Tenant context küçük accent/mark alanında kalsın; shell/action/status tokenlarını override edemesin.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: build shared Earnica application shell`.

## Task FA-10: DecisionWorkspace Composition'ını Kur

**Files:**

- Create: `apps/web/src/components/workspace/DecisionWorkspace.tsx`
- Create: `apps/web/src/components/workspace/ActionScopeGuard.tsx`
- Create: `apps/web/src/components/workspace/EvidenceTimeline.tsx`
- Create: `apps/web/src/components/workspace/LiveValueRail.tsx`
- Create: `apps/web/src/components/workspace/DecisionWorkspace.contract.node.test.ts`

**Compound API:**

```tsx
DecisionWorkspace.Root
DecisionWorkspace.Queue
DecisionWorkspace.Inspector
DecisionWorkspace.Header
DecisionWorkspace.Impact
DecisionWorkspace.Actions
DecisionWorkspace.ReadOnlyInspector
```

- [ ] Contract testte compound slots, operational/read-only variants, desktop split-pane, mobile Sheet ve focus return beklentilerini yaz; FAIL bekle.
- [ ] Selection/URL state'i workspace içinde saklama; controlled props ile route owner'a bırak.
- [ ] `ActionScopeGuard.Selected` ve `.AllResults` explicit summary/preview token gerektirsin.
- [ ] `EvidenceTimeline` event order/timestamp/source; `LiveValueRail` currency-grouped states kullansın.
- [ ] Nested generic Card üretme; tek main surface + dock hierarchy uygula.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica decision workspace`.

## Task FA-18: İlk Dört Versioned Visual Acceptance Frame'ini Üret

**Dependencies:** FA-01, FA-04, FA-05, FA-06, FA-07, FA-08, FA-09, FA-10.

**Files:**

- Create: `docs/superpowers/specs/assets/earnica-acceptance-01-brand-controls.png`
- Create: `docs/superpowers/specs/assets/earnica-acceptance-02-invite-auth.png`
- Create: `docs/superpowers/specs/assets/earnica-acceptance-03-member-home-wallet.png`
- Create: `docs/superpowers/specs/assets/earnica-acceptance-04-admin-workspace.png`
- Create: `docs/superpowers/specs/assets/earnica-acceptance-frames.json`

- [ ] Route implementation başlamadan önce `imagegen` ve onaylı `earnica-operations-workspace-reference.png` görüntüsünü aynı tasarım girdisinde kullan; kaynağı yalnız prose ile yeniden yorumlama.
- [ ] İlk fail gate: dört dosya yokken bundled Pillow ile existence/dimension kontrolü FAIL üretmeli.
- [ ] Frame 01'i 1600×1200 light+dark token/control/state sheet; Frame 02'yi 1600×1200 desktop+mobile valid+error invite/auth kompoziti olarak üret.
- [ ] Frame 03'ü 1800×1400 desktop+mobile new-user+blocked+settled Home/Wallet; Frame 04'ü 1800×1200 desktop+tablet loading+empty+error Admin Overview + full Decision Desk olarak üret.
- [ ] Ink sidebar, pearl canvas, LiveValueRail, cobalt/amber/mint semantics, hairline border, 8–12px radius, low shadow ve density-only-in-desk kararlarını reference ile yan yana kontrol et.
- [ ] Görseldeki fake data'yı manifestte `layout-only` işaretle; product/API contract olarak kullanma. Her frame'e version, dimensions, states, reference path ve `approval:'pending-user-review'` yaz; agent kendi kendine `user-approved` değeri veremez.
- [ ] Fake logo, CSS/div/handmade SVG, emoji icon, nested card soup, glass/neon/purple gradient veya mixed icon family varsa frame'i yeniden üret.
- [ ] Commit: `design: add Earnica acceptance frames one through four`.

## Task FA-19: HQ ve Accessibility Acceptance Frame'lerini Tamamla

**Dependencies:** FA-18.

**Files:**

- Create: `docs/superpowers/specs/assets/earnica-acceptance-05-hq-portfolio-company.png`
- Create: `docs/superpowers/specs/assets/earnica-acceptance-06-accessibility-states.png`
- Modify: `docs/superpowers/specs/assets/earnica-acceptance-frames.json`
- Create: `apps/web/src/app/acceptance-frames.contract.node.test.ts`

- [ ] Contract testte altı exact filename, version, required states, dimensions ve approved reference linkage beklentisini yaz; iki frame/manifest eksik olduğu için FAIL bekle.
- [ ] Frame 05'i 1600×1000 HQ portfolio + company inspection; Frame 06'yı 1600×1000 keyboard focus, selected, disabled-with-reason ve reduced-motion state sheet olarak üret.
- [ ] Reference ile aynı comparison input'unda typography, spacing, border/radius, token, focus ring, overflow/crop ve state hierarchy farklarını incele; high-impact mismatch varsa yeniden üret.
- [ ] Bundled Pillow dimension/alpha kontrolü ve `node --test apps/web/src/app/acceptance-frames.contract.node.test.ts`; PASS bekle.
- [ ] Altı frame'i kullanıcıya aynı approved reference ile birlikte göster ve açık görsel onay iste. Yalnız kullanıcı onayı sonrası manifestte reviewer/time ile `approval:'user-approved'` yaz; onay gelmezse route görevleri `BLOCKED: acceptance-frames-awaiting-user-review` kalır.
- [ ] Route görevleri yalnız manifestte altı frame `user-approved` olduktan sonra başlayabilir.
- [ ] Commit: `design: complete Earnica visual acceptance set`.

## Task FA-20: Email ve Push Şablonlarını Earnica Kimliğine Taşı

**Files:**

- Create: `apps/api/src/notifications/notification-brand.ts`
- Modify: `apps/api/src/notifications/templates.ts`
- Modify: `apps/api/src/notifications/notification-relay.service.ts`
- Create: `apps/api/src/notifications/templates.spec.ts`
- Modify: `apps/api/test/notifications.int-spec.ts`

- [ ] `notification-brand.ts` içindeki pinned version'ın FA-04 `BRAND_ASSET_VERSION` authority'siyle exact eşitliğini FA-22 cross-surface contract'ına bağla. Unit/integration testte visible Earnica name, `by Americana Studio`, `${WEB_URL}/brand/email-wordmark.png?v=${NOTIFICATION_BRAND.assetVersion}` biçiminde versioned asset URL'si, meaningful alt/fallback text, safe verification/reset links ve old visible brand absence beklentilerini yaz; FAIL bekle.
- [ ] Email subject/body/html ve push title/body'yi authoritative payout/invite/auth semantics ile normalize et; “sent/paid” gibi kanıtsız fulfillment iddiası yapma.
- [ ] Text-only ve narrow-client fallback'te markanın/eylemin anlaşılır kaldığını; token/secret'in log veya push preview'a sızmadığını test et.
- [ ] `pnpm.cmd --filter @refearn/api exec jest --selectProjects unit --runInBand --runTestsByPath src/notifications/templates.spec.ts` ve onaylı test DB'de `test/notifications.int-spec.ts`; PASS bekle.
- [ ] Commit: `feat: brand Earnica notification surfaces`.

## Task FA-21: Payout CSV ve Export Terminolojisini Normalize Et

**Files:**

- Modify: `apps/api/src/payouts/payouts.controller.ts`
- Modify: `apps/api/src/payouts/payouts.service.ts`
- Modify: `apps/api/test/payouts.int-spec.ts`
- Modify: `apps/web/src/app/admin/payouts/page.tsx`
- Create: `apps/web/src/app/admin/payouts/export-brand.contract.node.test.ts`

- [ ] Önce API/web contract testlerinde iki export sınıfını ayır: immutable batch payment instruction ile history/report. İkisinde de Earnica filename/title, canonical lifecycle labels, ISO currency ve no `mark paid`/unbacked `sent` wording; history/report'ta masked recipient/reference beklentilerini yaz ve FAIL bekle.
- [ ] Payment instruction CSV'si yalnız exact immutable batch + mevcut `payouts.process` permission kapsamında provider/manual ödeme için gerçekten gerekli allowlisted recipient fields'i (ör. full name/email) koruyabilir; blanket masking ile dosyayı işlevsiz yapma. History/report export'u masked kalır.
- [ ] CSV headers/filename ve export action copy'sini sınıfa göre canonical presentation sözlüğüne taşı; backend enum'u doğrudan user-facing label yapma.
- [ ] Hiçbir export routing/account/token/secret taşımaz; full settlement evidence yalnız ayrı protected detail flow'unda kalır.
- [ ] Payout integration ve `node --test apps/web/src/app/admin/payouts/export-brand.contract.node.test.ts`; PASS bekle.
- [ ] Commit: `fix: normalize Earnica payout exports`.

## Task FA-22: Route-Dışı Marka Yüzeyi Envanterini Kanıtla

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-brand-surface-inventory.json`
- Create: `apps/web/src/app/brand-surface-inventory.contract.node.test.ts`

- [ ] Contract testte metadata/favicon/PWA/native/email/push/QR/share/CSV-export ve printable-check surface satırlarını zorunlu kıl; tek `assetVersionAuthority: 'apps/web/src/lib/brand.ts#BRAND_ASSET_VERSION'` ve her applicable surface için exact eşit version şartı koy, JSON yokken FAIL bekle.
- [ ] Source scan ile her satıra owner file, visible name, asset version ve authority yaz. API `notification-brand.ts` ve mobile `app.json` değeri web constant'ını import edemediği için literal drift'i cross-surface contract source-reading ile fail ettir; ikinci bağımsız version owner tanımlama. Bu repository'de printable/check yüzeyi bulunmadığını doğrularsan `not-applicable` + exact search evidence kaydet; sahte surface üretme.
- [ ] Email/push için FA-20, CSV/export için FA-21, app icon/splash için MOB-16 dependency'sini kaydet; incomplete dependency'yi PASS yapma.
- [ ] `node --test apps/web/src/app/brand-surface-inventory.contract.node.test.ts`; PASS bekle.
- [ ] Commit: `docs: inventory Earnica brand surfaces`.

## Task FA-23: PWA Manifest ve Metadata Asset Binding'ini Ekle

**Dependencies:** FA-02, FA-03, FA-04.

**Files:**

- Create: `apps/web/src/app/manifest.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/lib/brand.contract.node.test.ts`

- [ ] Önce brand contract testine Earnica manifest name/short_name, `/` start_url, standalone display, theme/background colors, versioned 192/512 icon URLs ve root metadata manifest binding beklentilerini yaz; manifest yokken FAIL bekle.
- [ ] Next metadata route ile web manifest üret; icon URL'lerini `/brand/pwa-192.png?v=${BRAND_ASSET_VERSION}` ve `/brand/pwa-512.png?v=${BRAND_ASSET_VERSION}` authority'sinden üret, ikinci literal version tanımlama.
- [ ] Root metadata manifest/icons/apple-touch/OG alanlarını `BRAND_ASSET_VERSION` contract'ıyla eşleştir; duplicate veya old visible asset path bırakma.
- [ ] `node --test apps/web/src/lib/brand.contract.node.test.ts` ve `pnpm.cmd --filter @refearn/web lint --incremental false`; PASS bekle.
- [ ] Commit: `feat: bind Earnica PWA metadata assets`.

## Task FA-11: Public Landing'i Earnica Güven Yüzeyi Olarak Yenile

**Dependencies:** FA-18, FA-19, FA-23.

**Files:**

- Modify: `apps/web/src/app/page.tsx`
- Create: `apps/web/src/components/public/PublicHero.tsx`
- Create: `apps/web/src/components/public/TrustProof.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/page.contract.node.test.ts`

- [ ] Contract testte Earnica promise, by Americana Studio, login/invite entry points, authenticated landing ve no-unbacked-income-claim beklentilerini yaz; FAIL bekle.
- [ ] Public hero'yu gerçek wordmark, sakin product proof ve üç role outcome ile kur; dashboard card soup ekleme.
- [ ] “Track what was earned, why, and what happens next” gibi kanıta dayalı messaging kullan; garanti gelir iddiası yapma.
- [ ] Authenticated user'a session landing CTA/redirect sun; session yoksa public content görünür kalsın.
- [ ] Mobile 320/390 ve desktop 1440 layout contract'ını CSS semantic classes ile kullan.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: launch Earnica public trust surface`.

## Task FA-12: Ortak AuthShell ve Login → MFA State Machine'ini Uygula

**Dependencies:** FA-18, FA-19, FA-23.

**Files:**

- Create: `apps/web/src/components/auth/AuthShell.tsx`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/lib/auth.ts`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/login/page.contract.node.test.ts`

**States:** `credentials | mfa-challenge | expired | error | redirecting`.

- [ ] Contract testte credentials'ın challenge sırasında gizlenmesi, challenge expiry, restart, recovery code, password-manager/paste ve safe returnTo beklentilerini yaz; FAIL bekle.
- [ ] `AuthShell` Earnica primary + optional tenant context composition'ını uygulasın.
- [ ] `auth.ts` içinde `returnTo`yu yalnız same-origin allowlisted route + session capability ile kabul et; protocol-relative/external/rol dışı hedefi reddedip `landingForSession` fallback'ine dön. Login success bu helper'ı kullansın; challenge credentials tekrar istemeden second step'e geçsin.
- [ ] `expiresAt` server değerini kullan; client TTL üretme. Expired challenge restart state'i göstersin.
- [ ] Error'u field/general bağlamına programatik bağla; email enumeration veya raw backend detail sızdırma.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: redesign Earnica sign-in and MFA challenge`.

## Task FA-13: Forgot Password Initiation'ı Ekle

**Dependencies:** FA-18, FA-19, FA-23.

**Files:**

- Create: `apps/web/src/app/forgot-password/page.tsx`
- Modify: `apps/web/src/components/auth/AuthShell.tsx`
- Modify: `apps/web/src/app/login/page.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/forgot-password/page.contract.node.test.ts`

- [ ] Source contract testte `/auth/password-reset/request`, enumeration-safe identical success, email label/error ve login dönüş linkini yaz; FAIL bekle.
- [ ] Route'u AuthShell ile ekle; submit sonrası account-existence neutral success state göster.
- [ ] Login'e “Forgot password?” linkini ekle; challenge state'inde göstermeme kararını açık uygula.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica password recovery request`.

## Task FA-14: Verify Email ve Reset Password Outcome'larını Normalize Et

**Dependencies:** FA-18, FA-19, FA-23.

**Files:**

- Modify: `apps/web/src/app/verify-email/page.tsx`
- Modify: `apps/web/src/app/reset-password/page.tsx`
- Modify: `apps/web/src/components/auth/AuthShell.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/reset-password/auth-outcomes.contract.node.test.ts`

- [ ] Missing/invalid/expired/already-used/success/checking state contract testlerini yaz; FAIL bekle.
- [ ] Verify/reset sonuçlarını account existence sızdırmadan ayrı next action'larla göster.
- [ ] Password requirement, confirm, paste/password manager ve error association'ı koru.
- [ ] Başarı sonrası açık login action; unsafe automatic redirect yapma.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: normalize Earnica verification outcomes`.

## Task FA-15: MFA Enrollment ve Recovery Code Akışını Tamamla

**Dependencies:** FA-18, FA-19, FA-23.

**Files:**

- Modify: `apps/web/src/app/mfa-setup/page.tsx`
- Modify: `apps/web/src/components/auth/AuthShell.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/mfa-setup/page.contract.node.test.ts`

- [ ] Contract testte qrcode.react, manual secret, copy feedback, verification, recovery-code save confirmation, fresh login ve no-context login fallback beklentilerini yaz; FAIL bekle.
- [ ] Server `otpauthUrl` ile QR; secret'ı default masked/collapsible manual fallback yap.
- [ ] Recovery codes bir kez gösterilsin; kullanıcı kaydettiğini doğrulamadan devam action'ı aktif olmasın.
- [ ] Recovery code'u MFA reset/bypass gibi sunma; support-only lost-device copy kullan.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: complete Earnica MFA enrollment`.

## Task FA-16: Invite Trust ve Registration State Machine'ini Uygula

**Dependencies:** P0-03, P0-04, P0-05, FA-18, FA-19, FA-23.

**Files:**

- Modify: `apps/web/src/app/i/[code]/page.tsx`
- Create: `apps/web/src/components/auth/InviteTrustPanel.tsx`
- Modify: `apps/web/src/lib/i18n.ts`
- Create: `apps/web/src/app/i/[code]/page.contract.node.test.ts`
- Modify: `apps/web/src/lib/brand.ts`

- [ ] Valid/invalid/not-found/expired/revoked/used/tenant-suspended ve loading/error contract testlerini yaz; FAIL bekle.
- [ ] Used invite'ta anonymous/other-user generic copy + login/home yolu göster; authenticated same-user protected continuation DTO'su varsa yalnız server allowlisted `/app` CTA'sını kullan. Client tenant/account/member eşleşmesi tahmin etmesin ve otomatik account merge yapmasın.
- [ ] Earnica trust, tenant/expiry/program summary, masked locked email ve existing-account/MFA açıklamasını göster. Inviter yalnız P0-05 response'unda explicit disclosure authority ile geldiyse görünür; absent ise `Invited by {tenant}` fallback'ini kullan ve isim tahmin etme.
- [ ] Required accessible disclaimer checkbox olmadan submit'i kapat.
- [ ] POST body `acceptDisclaimer:true`, authoritative `disclaimerVersion`, `disclaimerLocale` göndersin; locked email'i maskeden reconstruct etme.
- [ ] MFA challenge gelirse credentials'ı kapat ve login ile aynı challenge semantics'i kullan.
- [ ] Contract test + typecheck; PASS bekle.
- [ ] Commit: `feat: build trusted Earnica invite onboarding`.

## Task FA-17: Foundation/Auth Checkpoint'ini Doğrula

**Files:**

- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] `rg -n --glob '!*.md' "Americana Earn|Refearn|Refferal|refearn-network-mark" apps/web/src apps/web/public` çalıştır; internal keys dışındaki visible match'leri düzelt.
- [ ] Exact source contract setini çalıştır: `node --test apps/web/src/lib/brand.contract.node.test.ts`, `node --test apps/web/src/app/theme.contract.node.test.ts`, `node --test apps/web/src/components/ui/overlay-primitives.contract.node.test.ts`, `node --test apps/web/src/components/product/product-primitives.contract.node.test.ts`, `node --test apps/web/src/lib/financial-presentation.contract.node.test.ts`.
- [ ] Shell/workspace/visual contract setini çalıştır: `node --test apps/web/src/components/shell/EarnicaShell.contract.node.test.ts`, `node --test apps/web/src/components/workspace/DecisionWorkspace.contract.node.test.ts`, `node --test apps/web/src/app/acceptance-frames.contract.node.test.ts`, `node --test apps/web/src/app/brand-surface-inventory.contract.node.test.ts`.
- [ ] Public/auth contract setini çalıştır: `node --test apps/web/src/app/page.contract.node.test.ts`, `node --test apps/web/src/app/login/page.contract.node.test.ts`, `node --test apps/web/src/app/forgot-password/page.contract.node.test.ts`, `node --test apps/web/src/app/reset-password/auth-outcomes.contract.node.test.ts`, `node --test apps/web/src/app/mfa-setup/page.contract.node.test.ts`, `node --test apps/web/src/app/i/[code]/page.contract.node.test.ts`.
- [ ] `pnpm.cmd --filter @refearn/web lint --incremental false`.
- [ ] `pnpm.cmd --filter @refearn/web build`.
- [ ] Kullanıcı Playwright izni verdiyse `/`, `/login`, `/forgot-password`, `/verify-email`, `/reset-password`, `/mfa-setup`, valid/invalid `/i/[code]` route'larını 390×844, 768×1024, 1440×900; light/dark/reduced-motion/keyboard ile doğrula.
- [ ] Reference frame + implementation screenshot'ını aynı viewport/state'te karşılaştır; visible mismatch varsa checkpoint'i kapatma.
- [ ] Checklist foundation/auth maddelerini yalnız kanıt sonrası tamamla.
- [ ] Commit: `test: verify Earnica foundation and auth`.

## Foundation/Auth Exit Criteria

- Gerçek mark/wordmark ve required export seti var; görünür old brand yok.
- Pearl default + dark preference aynı semantic state sözleşmesini kullanıyor.
- Shell/overlay/decision components focus, landmark ve responsive contract'ı geçiyor.
- Financial presentation BigInt/currency safe.
- Public/auth route'larda loading/empty/error/expired/success state'leri explicit.
- Login+MFA, reset/verify, enrollment ve invite görevleri keyboard-only tamamlanıyor.
- No package/lock/env/deploy change.
