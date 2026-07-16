# Earnica Verification and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Earnica redesign'inin spec acceptance kriterlerini; static checks, API contracts, browser görevleri, reference screenshot karşılaştırmaları, accessibility, performance, native QA ve rollback kanıtlarıyla dürüst biçimde kapatmak.

**Architecture:** Verification bir final smoke değil, checkpoint kanıtlarının birleşimidir. Her acceptance criterion machine-readable ledger'da PASS/FAIL/BLOCKED olur. Browser automation yalnız kullanıcı izniyle ve kullanıcının seçtiği browser'da çalışır. Visual QA reference+implementation aynı viewport/state comparison ile yapılır. Skipped platform veya external authority PASS sayılmaz.

**Tech Stack:** pnpm/Turbo, Jest, Node source contract tests, Next production build, Playwright CLI (izinli), in-app/user-selected browser, Expo Android/iOS verification, Git diff review.

## Global Constraints

- `verification-before-completion` ve `code-review-and-quality` skills'i completion iddiasından önce zorunludur.
- Playwright/direct browser control öncesi kullanıcıdan açık izin alınır.
- Screenshot tek başına QA değildir; reference ve implementation aynı comparison input'unda değerlendirilir.
- iOS/assistive technology/lab performance çalıştırılmadıysa unresolved/BLOCKED kalır.
- Production deploy, DNS ve env değişikliği bu planın dışında.
- Existing user files ve dirty changes final commit'e blanket stage edilmez.

## İzin Sonrası Exact Browser CLI Protokolü

- Önce `playwright-cli --version`; bulunmazsa yalnız mevcut local binary kontrolü için `npx --no-install playwright-cli --version`. İkisi de yoksa dependency kurma, browser matrix'i `BLOCKED: playwright-cli-unavailable` yap.
- Browser testleri mevcut dev listener/proxy portunu tahmin etmez. VR-03'ün isolated QA web/API health + fixture fingerprint gate'i geçtikten sonra verified `$env:EARNICA_BASE_URL` kullanılır; default QA web/API portları 3300/3311'dir, doluysa açıkça seçilen boş portlar matrix'e yazılır. `58156` yalnız kullanıcı in-app browser'ı seçmişse ve o proxy'nin verified QA base'e bağlı olduğu control aracıyla kanıtlanırsa kullanılabilir.
- Kullanıcı Chrome'u açıkça seçerse `playwright-cli -s=earnica-qa open --browser=chrome "$env:EARNICA_BASE_URL"`; Edge seçerse aynı komutu `--browser=msedge` ile çalıştır. In-app browser seçerse CLI ile başka browser launch etme; in-app browser control mekanizmasını kullan.
- CLI session için `playwright-cli -s=earnica-qa tracing-start`, `playwright-cli -s=earnica-qa resize 390 844`, `playwright-cli -s=earnica-qa snapshot --filename=C:\tmp\earnica-qa\current.yaml`, `playwright-cli -s=earnica-qa screenshot --filename=C:\tmp\earnica-qa\current.png`, `playwright-cli -s=earnica-qa tracing-stop`, `playwright-cli -s=earnica-qa close` sırasını kullan.
- Her etkileşim öncesi `playwright-cli -s=earnica-qa snapshot`; snapshot'ın live ref/role locator'ını kullan. Önceden tahmin edilmiş `eNN` ref'i veya production data kullanma.
- Query string içeren PowerShell navigation'da URL'yi quote et ve env expansion'ı koru: `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin/payouts?section=requests&page=1"`. `--%` kullanma; PowerShell env expansion'ını durdurur.

---

## Task VR-01: Acceptance Evidence Ledger'ını Oluştur

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-acceptance-ledger.json`
- Create: `apps/web/src/app/acceptance-ledger.contract.node.test.ts`

**Shape:**

```ts
type AcceptanceEvidence = {
  id: string;
  specLine: number;
  category: 'brand' | 'behavior' | 'coverage' | 'ux-quality';
  status: 'pending' | 'pass' | 'fail' | 'blocked';
  commands: string[];
  artifacts: string[];
  note: string;
};
```

- [ ] Contract testte spec Bölüm 21'deki 35 kriterin unique ID/line/category ve non-pass default status ile bulunmasını yaz; FAIL bekle.
- [ ] Ledger'a AC-01…AC-35 kayıtlarını exact spec line ile ekle; henüz kanıtlanmayanları `pending` bırak.
- [ ] Testi `node --test apps/web/src/app/acceptance-ledger.contract.node.test.ts` ile çalıştır; PASS bekle.
- [ ] Commit: `test: create Earnica acceptance ledger`.

## Task VR-02: Full Static/Test/Build Matrix'ini Çalıştır

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-acceptance-ledger.json`

- [ ] `pnpm.cmd --filter @refearn/api lint`.
- [ ] `pnpm.cmd --filter @refearn/api test --runInBand`.
- [ ] Approved test DB varsa required API integration suites; yoksa BLOCKED olarak kaydet.
- [ ] `pnpm.cmd --filter @refearn/web lint --incremental false`.
- [ ] Bütün web source contract testlerini exact discovered path ile çalıştır: `rg --files apps/web/src -g "*.contract.node.test.ts" | Sort-Object | ForEach-Object { node --test $_; if ($LASTEXITCODE -ne 0) { throw "contract test failed: $_" } }`.
- [ ] `pnpm.cmd --filter @refearn/web build`.
- [ ] `pnpm.cmd --filter @refearn/mobile lint`; ardından `node apps/mobile/test/theme-architecture.cjs`, `node apps/mobile/test/mfa-policy.cjs`, `node apps/mobile/test/auth-flows.cjs`, `node apps/mobile/test/member-surfaces.cjs`, `node apps/mobile/test/lifecycle-safety.cjs`, `node apps/mobile/test/remediation-contracts.cjs`.
- [ ] `pnpm.cmd --filter @refearn/mobile export:check`.
- [ ] `pnpm.cmd lint`, `pnpm.cmd test`, `pnpm.cmd build` full monorepo commands; mevcut unrelated failure varsa exact scope/evidence ile FAIL/BLOCKED yaz.
- [ ] Ledger'a command, exit code ve log artifact path ekle; failure'ı success diye özetleme.
- [ ] Commit: `test: record Earnica build and contract results`.

## Task VR-03: Browser Automation İzin Kapısını Aç

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-browser-matrix.json`
- Create: `apps/api/test/earnica-browser-fixtures.ts`
- Create: `apps/api/test/earnica-browser-fixtures.int-spec.ts`

- [ ] Kullanıcıdan direct Playwright CLI/browser automation izni iste; ambient browser state'i izin sayma.
- [ ] İzin yoksa matrix'i `blocked: user-browser-permission` yap ve browser tasks'i çalıştırma.
- [ ] İzin varsa yalnız user-selected browser'ı kullan; farklı browser launch etme.
- [ ] Evidence matrix'e yalnız verified base URL/API origin, selected browser, build/commit, viewport, redacted role aliases ve `fixtureRunHash` yaz; credential, password, refresh/access token, invite code, raw runtime JSON veya secret-bearing trace yazma.
- [ ] Fixture integration testini önce yaz: yalnız `DATABASE_URL === DATABASE_URL_TEST`, database adı test guard'ına uyuyor ve connected DB eşleşiyorsa unique `qa-earnica-{runId}` fixture'ı oluşturabilsin; production/non-test target'ta ilk mutation öncesi FAIL etsin.
- [ ] Fixture seti valid/expired/revoked/used invite; member/admin/restricted-admin/staff/platform-admin; new/blocked/settled member; 3-approved-sale+14-day NPS; mixed-currency HQ; payout request/batch drift/partial failure state'lerini üretir.
- [ ] Helper `C:\tmp\earnica-qa\fixture-runtime.json` exact path'ine unique run ID, exact created IDs, QA credentials ve invite codes yazar; repo dışı path/owner ACL ve restrictive mode doğrulanamıyorsa dosya oluşturmaz ve browser tasks'i `BLOCKED: secure-fixture-runtime-unavailable` bırakır. Evidence JSON yalnız aliases/hash taşır.
- [ ] Seed transaction'ı runtime manifest yazılmadan başarısız olursa tamamen rollback olur. `cleanup-db --runtime-path=...` yalnız manifestteki exact created IDs'leri verified test DB'de siler; `cleanup-runtime --runtime-path=...` normalized path'in exact owned temp file olduğunu doğruladıktan sonra yalnız o dosyayı siler. Broad prefix delete/reset veya repository cleanup komutu yoktur.
- [ ] Isolated DB test/seed'i her komutta explicit env ile çalıştır: `$env:DATABASE_URL=$env:DATABASE_URL_TEST; pnpm.cmd --filter @refearn/api exec jest --selectProjects integration --runInBand --runTestsByPath test/earnica-browser-fixtures.int-spec.ts`; ardından `$env:DATABASE_URL=$env:DATABASE_URL_TEST; pnpm.cmd --filter @refearn/api exec ts-node test/earnica-browser-fixtures.ts seed --runtime-path=C:\tmp\earnica-qa\fixture-runtime.json`.
- [ ] QA portlarını boş oldukları kanıtlandıktan sonra ayarla: `$env:EARNICA_QA_WEB_PORT='3300'`, `$env:EARNICA_QA_API_PORT='3311'`, `$env:EARNICA_BASE_URL="http://localhost:$env:EARNICA_QA_WEB_PORT"`, `$env:EARNICA_API_ORIGIN="http://localhost:$env:EARNICA_QA_API_PORT"`; `Test-NetConnection` dolu gösterirse farklı açık port seç ve matrix'e exact değerleri yaz.
- [ ] Ayrı QA API terminali önceki shell env'ine güvenmez. Recorded portlar 3300/3311 ise exact aynı process command'ı kullan: `$env:EARNICA_QA_WEB_PORT='3300'; $env:EARNICA_QA_API_PORT='3311'; $env:EARNICA_BASE_URL="http://localhost:$env:EARNICA_QA_WEB_PORT"; $env:EARNICA_API_ORIGIN="http://localhost:$env:EARNICA_QA_API_PORT"; $env:DATABASE_URL=$env:DATABASE_URL_TEST; $env:PORT=$env:EARNICA_QA_API_PORT; $env:WEB_URL=$env:EARNICA_BASE_URL; $env:CORS_ORIGINS=$env:EARNICA_BASE_URL; pnpm.cmd --filter @refearn/api start:dev`. Alternate verified port seçildiyse bütün literal port değerlerini matrix'teki değerlerle birlikte değiştir. Approved test DB yoksa start etme ve browser tasks'i BLOCKED bırak.
- [ ] Ayrı QA web terminali de bütün env'leri kendi processinde yeniden set eder: `$env:EARNICA_QA_WEB_PORT='3300'; $env:EARNICA_QA_API_PORT='3311'; $env:EARNICA_BASE_URL="http://localhost:$env:EARNICA_QA_WEB_PORT"; $env:EARNICA_API_ORIGIN="http://localhost:$env:EARNICA_QA_API_PORT"; $env:NEXT_PUBLIC_API_URL="$env:EARNICA_API_ORIGIN/v1"; pnpm.cmd --filter @refearn/web build`; build PASS sonrası aynı terminalde `$env:NEXT_PUBLIC_API_URL="$env:EARNICA_API_ORIGIN/v1"; pnpm.cmd --filter @refearn/web exec next start -p $env:EARNICA_QA_WEB_PORT`. Alternate portlar aynı şekilde literal matrix değerleriyle değiştirilir. Package/dependency/env file değiştirme.
- [ ] Runtime manifesti ekrana basmadan PowerShell object olarak oku. API health'i `$env:EARNICA_API_ORIGIN/healthz`, web root'u `$env:EARNICA_BASE_URL/` üzerinden 200/assertion ile doğrula; direct invite probe'un response tenant display/run ID'si runtime manifest ile exact eşleşmezse yanlış DB kabul et ve browser'a geçme.
- [ ] İlk browser valid-invite görünümünde run-specific tenant etiketi görünmeden fixture/API/web binding gate'ini PASS yapma. Listener 500, stale dev build, yanlış API origin veya DB fingerprint mismatch ise exact FAIL/BLOCKED kaydet.
- [ ] Health PASS sonrası `Get-NetTCPConnection` ile exact QA web/API portlarının `OwningProcess` değerlerini al; `Get-CimInstance Win32_Process` ile command line'ın bu workspace'teki Next/Nest start komutuna ait olduğunu doğrula ve yalnız PID/port/command hash'ini matrix'e yaz. VR-15 yalnız bu recorded ownership'i durdurabilir.
- [ ] Commit: `test: initialize Earnica browser matrix`.

## Task VR-04: Public/Auth Browser Görevlerini Çalıştır

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-browser-matrix.json`

**Routes/tasks:**

- `/`: public promise, login CTA, authenticated landing.
- `/login`: credentials → MFA → landing; invalid/expired/recovery/restart.
- `/forgot-password`: enumeration-safe success.
- `/verify-email`: missing/invalid/expired/used/success.
- `/reset-password`: invalid/expired/success.
- `/mfa-setup`: QR/manual/recovery save confirmation.
- `/i/[code]`: valid/not-found/expired/revoked/used/tenant-suspended/locked email/consent/MFA.

- [ ] Task processinin başında matrix'i oku; `baseUrl` exact `^http://localhost:\d+$` allowlist'ine ve VR-03 health sonucuna uyuyorsa `$env:EARNICA_BASE_URL` olarak set et, aksi halde browser'a geçme. Önceki shell env'ine güvenme.
- [ ] İzinli CLI browser seçildiyse verified base üzerinde exact route başlangıçlarını aç: `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/login"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/forgot-password"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/verify-email"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/reset-password"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/mfa-setup"`. Invite URL'lerini repo dışı runtime object'ten kur; code'u matrix/log/screenshot adına kopyalama.
- [ ] 390×844, 768×1024 ve 1440×900; light/dark/reduced-motion states'i çalıştır.
- [ ] Keyboard-only tab order, focus visibility, overlay focus return, form labels/errors ve paste/password-manager behavior'ı doğrula.
- [ ] Network/log'da consent version/locale ve no refresh token/full locked email leak'i doğrula.
- [ ] Screenshot, trace ve sonucu matrix'e bağla; issue varsa matrix'i FAIL yap, exact owner task'ı yeniden aç ve production düzeltmesini o task'ta yaptıktan sonra tekrar test et.
- [ ] Commit: `test: verify Earnica public and auth flows`.

## Task VR-05: Member Browser Görevlerini Çalıştır

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-browser-matrix.json`

- [ ] Task processinin başında matrix'teki allowlisted/health-verified `baseUrl` değerini yeniden `$env:EARNICA_BASE_URL` olarak set et; önceki task shell env'ine güvenme.
- [ ] İzinli CLI browser seçildiyse `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/app"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/app/wallet"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/app/team"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/app/invite"` ile route başlangıçlarını aç.
- [ ] Member role ile `/app`, wallet, team, invite route'larını cold/reload/Back/Forward çalıştır.
- [ ] Home readiness next action, Wallet blocker/remediation/request/history, Team list alternative, Invite create/copy/QR/history görevlerini keyboard ile tamamla.
- [ ] 320×800 ve 390×844 no page horizontal scroll; 44px target ve %200 zoom reflow kontrolü.
- [ ] Offline/stale simulation'da financial mutation disabled ve stale timestamp görünür.
- [ ] Multi-currency fixture varsa values ayrı; yoksa contract test evidence'sini bağla, UI'da fake fixture üretme.
- [ ] Light/dark/reduced-motion screenshots/traces matrix'e ekle.
- [ ] Commit: `test: verify Earnica member flows`.

## Task VR-06: Admin/HQ Browser Görevlerini Çalıştır

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-browser-matrix.json`

- [ ] Task processinin başında matrix'teki allowlisted/health-verified `baseUrl` değerini yeniden `$env:EARNICA_BASE_URL` olarak set et ve repo dışı runtime JSON'u ekrana basmadan `$qa` object'ine yükle; önceki task shell env'ine güvenme.
- [ ] İzinli CLI browser seçildiyse exact full route başlangıçlarını aç: `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin/sales"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin/members"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin/tree"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin/payouts"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin/audit"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/admin/settings"`, `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/platform"`; company detail ID'sini repo dışı runtime object'ten al ve `playwright-cli -s=earnica-qa goto "$env:EARNICA_BASE_URL/platform/companies/$($qa.companies.primary.id)"` çalıştır.
- [ ] Owner/admin/restricted custom admin/staff role matrisiyle admin routes allow/403/navigation görünürlüğünü doğrula.
- [ ] Overview queue→inspector; Sales filters/selection/selected/all-results/drift/partial retry; Members invite/role/status; Network search/list; Payout scope/settle/fail; Audit filters; Settings permission görevlerini çalıştır.
- [ ] URL reload ve Back/Forward açık inspector/filter/selection state'ini geri kursun.
- [ ] Platform admin ile portfolio filters, company inspection/network/governance; tenant owner ile platform 403/no hydrate.
- [ ] Double-submit/network retry, cross-tenant IDs, masked settlement evidence ve mixed currency cases'i çalıştır.
- [ ] 360, 768, 1024, 1440; light/dark/reduced-motion/keyboard matrix'ini kaydet.
- [ ] Commit: `test: verify Earnica admin and HQ flows`.

## Task VR-07: Reference-Based Visual Acceptance'ı Yap

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-visual-comparison.json`

**References:** `docs/superpowers/specs/assets/earnica-operations-workspace-reference.png` ve FA-18/FA-19'da versioned altı `earnica-acceptance-0*.png` frame'i.

- [ ] `/admin` representative state'i reference ile aynı viewport/state/data density'de screenshot al.
- [ ] Reference ve implementation screenshot'ını aynı visual comparison input'unda değerlendir.
- [ ] Shell width, main surface, Decision Desk, type scale/weight, spacing, border/radius, token, icon, overflow/crop farklarını JSON'a yaz.
- [ ] Her visible mismatch için exact owner file/task oluştur ve bu evidence task'ını FAIL bırak; production düzeltmesini VR-07'nin tek JSON file scope'unda yapma. Owner task tamamlandıktan sonra aynı viewport/state'te yeniden compare et.
- [ ] Public/auth, member Home/Wallet, admin overview/Decision Desk, HQ ve accessibility states'i foundation'da üretilmiş versioned frame'lerle karşılaştır; final aşamada yeni yön icat etme.
- [ ] Decorative chart, nested card, glass/neon/purple/emoji/mixed-icon audit'i yap.
- [ ] PASS yalnız high-impact mismatch kalmadığında ver.
- [ ] Commit: `test: record Earnica visual acceptance`.

## Task VR-08: Responsive Boundary Matrix'ini Kapat

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-responsive-matrix.json`

- [ ] 320 ve 390 CSS px no page-level horizontal scroll.
- [ ] 767/768, 1023/1024, 1279/1280, 1439/1440 breakpoint çiftlerinde shell/dock/table behavior'ı kaydet.
- [ ] %200 zoom ve 320 CSS px/%400 reflow'da critical text/action loss kontrolü.
- [ ] Tables desktop semantic; mobile task-specific rows/sheets; no clipped finance action.
- [ ] Touch target 44×44 ve safe-area behavior'ı web/mobile kanıtlarıyla bağla.
- [ ] FAIL route için exact owner task'ı yeniden aç; VR-08'in tek JSON file scope'unda production düzeltmesi yapma. Owner task sonrası aynı boundary'de tekrar test et.
- [ ] Commit: `test: verify Earnica responsive boundaries`.

## Task VR-09: Accessibility Matrix'ini Kapat

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-accessibility-matrix.json`

- [ ] Keyboard-only: invite accept, login+MFA, readiness remediation, payout request, admin review/approve/reject, bulk scope ve HQ inspect. Member Record sale P0-20 onaylandıysa sale submit'i de çalıştır; onaylanmadıysa criterion'ı BLOCKED kaydet, sahte CTA üretme.
- [ ] Landmarks, one H1, labels/errors, status live regions, table headers/sort/selection, overlay focus trap/return ve skip links.
- [ ] Automated/source contrast pairs light/dark idle/hover/focus/pressed/selected/disabled/error.
- [ ] NVDA+Chrome ve VoiceOver+Safari/iOS sonuçları gerçek ortam yoksa unresolved; simüle edilmiş PASS verme.
- [ ] TalkBack+Android ve Dynamic Type %200 sonuçlarını native matrix'e bağla.
- [ ] WCAG 2.2 Accessible Authentication: paste/password manager/help mechanisms engellenmez.
- [ ] Reduced-motion'da bilgi/görev kaybı olmadığını doğrula.
- [ ] Commit: `test: record Earnica accessibility evidence`.

## Task VR-10: Performance Lab Matrix'ini Çalıştır

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-performance-matrix.json`

**Routes:** `/`, valid `/i/[code]`, `/app`, `/admin`, `/admin/payouts`, `/platform`.

- [ ] Task processinin başında browser matrix'teki allowlisted/health-verified `baseUrl` değerini yeniden `$env:EARNICA_BASE_URL` olarak set et ve repo dışı runtime object'i secret output üretmeden yükle; önceki shell env'ine güvenme.
- [ ] Production-like build ve representative data (operations list >=50 rows) kullan; dev-mode score kullanma.
- [ ] Önce mevcut binary availability'yi kanıtla: `lighthouse.cmd --version`; bulunmazsa `Test-Path node_modules\.bin\lighthouse.cmd`; son no-install kontrolü `pnpm.cmd exec lighthouse --version`. Hiçbiri mevcut binary döndürmezse package indirme/ekleme ve task'ı `BLOCKED: lighthouse-binary-unavailable` yap.
- [ ] Chrome/Lighthouse için kullanıcı ayrıca Chrome'u seçmiş/onaylamışsa verified `$env:EARNICA_BASE_URL` üzerinde çalış. Seçilen browser Chrome değilse başka browser launch etme; bu task'ı `BLOCKED: chrome-lighthouse-not-authorized` yap.
- [ ] Her public route/cold run için mevcut binary biçimine göre exact template'i üç kez çalıştır: `lighthouse.cmd "$url" --only-categories=performance --form-factor=mobile --throttling-method=simulate --throttling.rttMs=150 --throttling.throughputKbps=1638.4 --throttling.cpuSlowdownMultiplier=4 --output=json --output-path="C:\tmp\earnica-qa\lighthouse-$routeSlug-$run.json" --chrome-flags="--headless=new --incognito --disable-extensions"`. Local-only binary ise command başını `node_modules\.bin\lighthouse.cmd`, verified pnpm binary ise `pnpm.cmd exec lighthouse` yap; flags'i değiştirme.
- [ ] `/`, valid `/i/[code]` ve authenticated `/app`, `/admin`, `/admin/payouts`, `/platform` satırlarının her biri için auth state'i gerçek QA login ile doğrula. Lighthouse'a secret-safe authenticated ephemeral Chrome profile/remote-debug session bağlanamıyorsa authenticated satırları `BLOCKED: authenticated-lighthouse-harness-unavailable` bırak; public score'u onlara kopyalama ve credential'ı flag/header/artifact'a yazma.
- [ ] Her primary interaction öncesi izinli QA Chrome session'ında `PerformanceObserver` Event Timing buffer'ını `playwright-cli -s=earnica-qa eval` ile başlat, live snapshot ref'iyle exact primary action'ı çalıştır, ardından yalnız duration/interactionId değerlerini eval ile oku. Event Timing unsupported veya interaction deterministic değilse `<200ms` criterion'ını BLOCKED bırak; tooling wall-clock süresini INP diye raporlama.
- [ ] Her route'un üç JSON'undan `audits."largest-contentful-paint".numericValue` ve `audits."cumulative-layout-shift".numericValue` değerlerini PowerShell `Get-Content -Raw | ConvertFrom-Json` ile çıkar; üç cold run medyanını ve Event Timing üç-run medyanını kaydet. Runtime invite code/credential veya raw profile path'i repository evidence'ına yazma.
- [ ] Targets: LCP <2.5s, CLS <0.1, scripted interaction <200ms.
- [ ] Target sapmasını gizleme; route/component/request cause evidence'siyle FAIL yaz ve exact owner/optimization task'ı aç. VR-10'un tek JSON file scope'unda production değiştirme.
- [ ] Client component boundary, image sizing/cache, table pagination ve layout motion audit'i yap.
- [ ] RUM/production p75 deploy kapsamında olmadığından `not-run`, PASS değil.
- [ ] Commit: `test: measure Earnica lab performance`.

## Task VR-11: Native Verification Sonuçlarını Birleştir

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-acceptance-ledger.json`
- Modify: `docs/superpowers/plans/evidence/earnica-ios-verification.json`

- [ ] Android emulator ve en az bir fiziksel Android matrix sonuçlarını acceptance kriterlerine bağla; yalnız emulator kanıtıyla native criterion'ı PASS yapma.
- [ ] iOS actual result yoksa unresolved entries'i koru.
- [ ] Deep links, MFA/recovery, invite consent, background/resume, offline financial state, keyboard, safe area, reduced motion, Dynamic Type ve screen reader evidence'sini bağla.
- [ ] Native app icon/splash screenshots/asset dimensions'i brand criteria'ya bağla.
- [ ] Atlanan native platform nedeniyle overall mobile complete deme.
- [ ] Commit: `test: merge Earnica native evidence`.

## Task VR-12: User-Visible Brand ve Terminology Sweep Yap

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-acceptance-ledger.json`

- [ ] Source scan: `rg -n --glob '!*.md' "Americana Earn|Refearn|Refferal|refearn-network-mark|mark paid|sent payout|issued|mailed" apps/web apps/mobile apps/api/src/notifications`.
- [ ] Internal `@refearn/*`, storage keys, migration history ve compatibility scheme matches'ini allowlist evidence olarak kaydet; toplu rename yapma.
- [ ] Metadata, favicon, app name/icon/splash, email/push, QR/share, CSV/export ve printable surfaces'i ayrı kontrol et.
- [ ] Payout terminology mapper dışındaki raw presentation switch'lerini finding olarak kaydet, ledger'ı FAIL yap ve FA-20/FA-21 veya ilgili route owner task'ını yeniden aç; VR-12'nin tek ledger file scope'unda production düzeltmesi yapma.
- [ ] Search result + allowlist artifact'ını ledger'a bağla.
- [ ] Commit: `fix: complete Earnica terminology sweep`.

## Task VR-13: Bağımsız Code Review ve Quality Audit'i Çalıştır

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-code-review.json`

- [ ] `code-review-and-quality` skill'ini kullan; correctness, security, accessibility, performance, maintainability, API/UI contract ve test coverage axes.
- [ ] Review scope'u exact changed files/commits ile sınırla; unrelated dirty files'e fix yazma.
- [ ] P0/P1 findings'i owner task'a dönüp düzelt; P2/P3 defer edilirse rationale/effect yaz.
- [ ] `git diff --check` ve changed-file-only review yap.
- [ ] Review findinglerini file/line/evidence/status ile JSON'a kaydet.
- [ ] P0/P1 açıkken completion gate'i kapatma.
- [ ] Commit: `test: record Earnica code quality review`.

## Task VR-14: Rollback ve Release Sınırını Doğrula

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-rollout.json`

- [ ] Her checkpoint commit range'i, DB migration dependency'si ve rollback order'ını yaz.
- [ ] Additive migration'ların down/forward-fix stratejisini kaydet; production migration çalıştırma.
- [ ] User-visible brand asset cache version ve old-client compatibility'yi kaydet.
- [ ] Schema-dependent UI P0 gate geçmeden release-ready işaretlenmesin.
- [ ] Deploy/DNS/env işlerinin scope dışı olduğunu açık yaz.
- [ ] Commit: `docs: define Earnica rollout and rollback evidence`.

## Task VR-15: Verification-Before-Completion Final Gate'ini Çalıştır

**Files:**

- Modify: `docs/superpowers/plans/evidence/earnica-acceptance-ledger.json`
- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] `verification-before-completion` skill'ini oku ve fresh command evidence ile uygula.
- [ ] Full status: exact changed files, exact commands, exit results, intentionally unchanged files/scopes.
- [ ] 35 acceptance criterion'ı PASS/FAIL/BLOCKED olarak kapat; pending bırakma.
- [ ] BLOCKED criterion için blocker, üç kez denenmiş safe check gerekiyorsa evidence ve user action yaz; blocked'i pass yapma.
- [ ] `git status --short`, `git diff --check`, staged exact-name review ve commit history audit.
- [ ] Başarı/failure `finally` adımında Playwright session'ını kapat; recorded QA API/web PID'lerinin command path+port ownership'ini doğrulayıp graceful stop et. Başka listener/process'e dokunma.
- [ ] Aynı verified test DB env'iyle `$env:DATABASE_URL=$env:DATABASE_URL_TEST; pnpm.cmd --filter @refearn/api exec ts-node test/earnica-browser-fixtures.ts cleanup-db --runtime-path=C:\tmp\earnica-qa\fixture-runtime.json`; ardından `pnpm.cmd --filter @refearn/api exec ts-node test/earnica-browser-fixtures.ts cleanup-runtime --runtime-path=C:\tmp\earnica-qa\fixture-runtime.json` çalıştır. Exact created IDs veya runtime file temizlenemezse final gate'i FAIL/BLOCKED bırak; credential runtime dosyasını geride bırakıp complete deme.
- [ ] Cleanup kanıtına yalnız deleted row counts, run hash, normalized path ve PID/port sonucu yaz; credential, invite code veya token yazma.
- [ ] Production deploy/push yalnız kullanıcı ayrıca ister ve git scope temiz/onaylıysa yapılır.
- [ ] Final checkpoint commit: `test: close Earnica redesign verification`.

## Verification Exit Criteria

- Acceptance ledger'da pending yoktur; PASS gerçek evidence, BLOCKED gerçek external constraint taşır.
- Required static/API/build tests fresh run ile geçmiştir veya exact failure açıktır.
- Browser automation kullanıcı izni ve selected browser ile tamamlanmıştır ya da blocked'dır.
- Visual QA reference+implementation comparison ile yapılmıştır.
- Responsive/accessibility/performance/native matrisler dürüst sonuç taşır.
- Code review P0/P1 açık finding bırakmaz.
- Rollback sınırı ve intentionally unchanged scopes kayıtlıdır.
