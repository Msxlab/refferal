# Earnica Mobile Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expo uygulamasını Earnica marka/semantic sistemiyle yeniden tasarlamak; web ile invite consent, MFA challenge, payout readiness/lifecycle ve member task parity'sini sağlamak; native background, offline, Dynamic Type ve accessibility davranışlarını açık kapılarla doğrulamak.

**Architecture:** Mobile aynı semantic meaning'i native token/component layer üzerinden uygular; web CSS/component code'u kopyalamaz. Root/session guard ve Expo Router yapısı korunur. Auth/invite state machine shared mobile components'e ayrılır. Home/Wallet/Team/Invite tabları server-authoritative P0 DTO'ları tüketir. Admin/HQ native değildir; `/privileged` güvenli web handoff'tur.

**Tech Stack:** Expo SDK 52, Expo Router 4, React Native 0.76, React 18, react-native-svg/qrcode, AsyncStorage, existing notification/deep-link infrastructure.

## Global Constraints

- Yeni package eklenmez; `apps/mobile/package.json` ve lockfile değiştirilmez.
- Internal bundle/package/workspace adları ve mevcut `refearn` deep-link scheme kaldırılmaz; visible name Earnica olur.
- Native admin/HQ route'u eklenmez; current web handoff korunur.
- Icon library kurulu değildir. Yeni dependency veya ASCII/emoji ikon kullanılmaz; tab labels + active indicator premium ve erişilebilir biçimde kullanılabilir.
- iOS Simulator bu Windows ortamında çalıştırılamaz; macOS/Xcode veya gerçek cihaz kanıtı yoksa iOS unresolved kalır.
- Financial offline data stale etiketi olmadan actionable gösterilmez; offline payout mutation yoktur.
- `Number(cents)` financial rendering'de kullanılmaz.

---

## Task MOB-01: Mobile Visible Metadata ve In-App Earnica Mark'ını Bağla

**Files:**

- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/src/lib/brand.ts`
- Modify: `apps/mobile/src/components/ui.tsx`
- Create: `apps/mobile/assets/earnica-mark.png`
- Modify: `apps/mobile/test/theme-architecture.cjs`

- [ ] Theme architecture testine visible name Earnica, endorsement, new asset path, preserved internal scheme/package ve no old visible asset expectations ekle; FAIL bekle.
- [ ] FA source artwork'tan yalnız in-app UI mark export'u üret; CSS/div art veya handcrafted SVG kullanma. Platform icon/splash export'u MOB-16'nın sorumluluğudur.
- [ ] `app.json` visible display name/description ve mevcut compatibility metadata'sını Earnica'ya bağla; icon/splash/adaptive references'i MOB-16 tamamlanmadan final kabul etme ve package/bundle/scheme'i toplu rename etme.
- [ ] `Brand` component Earnica wordmark/endorsement primary, optional tenant context secondary kullansın.
- [ ] Old `refearn-network-mark-v1.png` importunu kaldır; dosyayı bu task'ta silme.
- [ ] Test + mobile typecheck; PASS bekle.
- [ ] Commit: `feat: apply Earnica mobile brand metadata`.

## Task MOB-16: Native App Icon, Adaptive Foreground ve Splash Setini Üret

**Dependencies:** FA-01 vector/source gate ve MOB-01.

**Files:**

- Create: `apps/mobile/assets/earnica-app-icon.png`
- Create: `apps/mobile/assets/earnica-adaptive-foreground.png`
- Create: `apps/mobile/assets/earnica-splash.png`
- Modify: `apps/mobile/app.json`
- Modify: `apps/mobile/test/theme-architecture.cjs`

- [ ] Önce theme architecture testine 1024×1024 opaque app icon, 432×432 transparent adaptive foreground safe-zone, solid adaptive background ve exact splash reference/dimension beklentilerini yaz; assetler olmadığı için FAIL bekle.
- [ ] Approved FA source artwork'tan bundled Pillow runtime ile app icon/splash raster export et; artwork'ü stretch etme, fake CSS/emoji/SVG kullanma.
- [ ] iOS/general icon 1024×1024 ve alpha yok; Android foreground 432×432 transparent ve center safe zone içinde; adaptive background `app.json` içinde solid approved Earnica ink/light color olsun.
- [ ] Splash gerçek Earnica mark/wordmark'ı safe-area içinde kullanır; mark crop/blur/halo içermez.
- [ ] `app.json` icon/adaptiveIcon/splash path'lerini exact assetlere bağla; `expo.extra.earnicaBrandAssetVersion` değerini FA-04 authority'siyle exact `earnica-v1` eşleştir ve theme architecture/FA-22 cross-surface testinde drift'i fail ettir. Bundle/package/scheme compatibility'sini koru.
- [ ] `node apps/mobile/test/theme-architecture.cjs` ve `pnpm.cmd --filter @refearn/mobile export:check`; PASS bekle.
- [ ] Commit: `build: export Earnica native app assets`.

## Task MOB-02: Native Obsidian + Pearl Token ve Primitive Sistemini Kur

**Dependencies:** MOB-16.

**Files:**

- Modify: `apps/mobile/src/theme.ts`
- Modify: `apps/mobile/src/components/ui.tsx`
- Create: `apps/mobile/src/components/EarnedTrace.tsx`
- Modify: `apps/mobile/src/lib/format.ts`
- Modify: `apps/mobile/test/theme-architecture.cjs`

- [ ] Testte ink/pearl/cobalt/amber/mint/rose semantic pairs, light/dark contrast, 44px target, reduced-motion, 8–12px radius ve no default glow/shadow expectations yaz; FAIL bekle.
- [ ] Old quiet-fintech palette'i Earnica semantic color roles ile değiştir; screen'ler raw hex kullanmasın.
- [ ] Card primitive'i `Surface/Section/Row` hierarchy'sine indir; nested card ihtiyacını azalt.
- [ ] `MoneyCounter` Number conversion'ını kaldır; existing BigInt-safe `money()` output ve optional masked text transition kullan.
- [ ] `EarnedTrace` yalnız authoritative new event key ile one-shot motion; reduced-motion'da statik.
- [ ] Theme tests + mobile typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica native design system`.

## Task MOB-03: Root ve Tab Shell'i Earnica Hiyerarşisine Taşı

**Files:**

- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/index.tsx`
- Modify: `apps/mobile/app/(tabs)/_layout.tsx`
- Modify: `apps/mobile/src/components/ui.tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`

- [ ] Theme testine root ThemeProvider/session restore, safe area, tab active indicator, 44px target ve no ASCII/emoji icon expectations ekle; FAIL bekle.
- [ ] Root redirect order: no session→login; partial MFA/setup→auth continuation; member→tabs; privileged→handoff.
- [ ] Tab bar pearl/ink semantic surface, clear text labels, cobalt active rule ve safe-area padding kullansın.
- [ ] Dynamic Type'ta labels truncate olup anlamsızlaşmasın; minimum widths ve accessible labels sağla.
- [ ] Test + typecheck; PASS bekle.
- [ ] Commit: `feat: rebuild Earnica native shell`.

## Task MOB-04: Ortak MFA Challenge Panel ve State Machine'ini Ekle

**Files:**

- Modify: `apps/mobile/src/lib/api.ts`
- Modify: `apps/mobile/app/login.tsx`
- Modify: `apps/mobile/app/i/[code].tsx`
- Create: `apps/mobile/src/components/MfaChallengePanel.tsx`
- Create: `apps/mobile/test/auth-flows.cjs`

**States:** `credentials | challenge | expired | invalid-code | submitting | complete`.

- [ ] Source contract testte challenge sırasında credentials hidden, server expiresAt, restart, recovery code, token memory-only ve no generic regex coupling beklentilerini yaz; FAIL bekle.
- [ ] API error mapper stable code/status kullansın; exact English message regex'e güvenme.
- [ ] `MfaChallengePanel` login ve invite flow'da aynı props/state semantics'i kullansın.
- [ ] Challenge token AsyncStorage'a yazılmasın; unmount/restart'ta temizlensin.
- [ ] App resume'da expiry server/local timestamp ile yeniden kontrol; expired state yeni challenge gerektirsin.
- [ ] Auth-flow test + typecheck; PASS bekle.
- [ ] Commit: `feat: unify Earnica mobile MFA challenge`.

## Task MOB-05: Mobile Invite Trust ve Consent Contract'ını Bağla

**Dependencies:** P0-03, P0-04, P0-05 ve MOB-04.

**Files:**

- Modify: `apps/mobile/app/i/[code].tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Modify: `apps/mobile/test/auth-flows.cjs`
- Modify: `apps/mobile/src/lib/api.ts`

- [ ] Testte valid/invalid/expired/revoked/used/tenant-suspended, tenant/expiry, inviter yalnız explicit P0-05 disclosure authority ile present, absent inviter'da tenant fallback, masked locked email ve required consent expectations yaz; FAIL bekle.
- [ ] Used invite'ta anonymous/other-user generic result ve no tenant/account leak; authenticated same-user protected continuation response'unda server allowlisted member route'una devam beklentilerini test et. Client membership match veya account merge tahmin etmesin.
- [ ] Required accessible checkbox olmadan submit disabled; income disclaimer ve existing-account/MFA yolu açık.
- [ ] POST body `acceptDisclaimer:true`, authoritative version ve locale göndersin.
- [ ] Locked email'i masked response'tan reconstruct etme; server locked authority contract'ını kullan.
- [ ] Version mismatch/expired invite form'u kapatsın ve safe next action göstersin.
- [ ] Auth-flow test + typecheck; PASS bekle.
- [ ] Commit: `feat: add trusted Earnica mobile invite onboarding`.

## Task MOB-06: Auth, MFA Setup ve Privileged Handoff Görsel Ailesini Kur

**Files:**

- Create: `apps/mobile/src/components/AuthScaffold.tsx`
- Modify: `apps/mobile/app/login.tsx`
- Modify: `apps/mobile/app/mfa-setup.tsx`
- Modify: `apps/mobile/app/privileged.tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`

- [ ] Önce `apps/mobile/test/auth-flows.cjs` assertions'ına shared scaffold, credential/challenge separation, recovery confirmation, secure handoff, keyboard/small-screen/%200 text beklentilerini ekle; mevcut yüzeyler nedeniyle FAIL bekle.
- [ ] Auth scaffold Earnica primary brand, optional tenant context, safe-area/keyboard-aware single task surface kullansın.
- [ ] Login credentials/challenge, setup QR/manual secret/recovery codes ve privileged explanation aynı type/spacing/state primitives'i kullansın.
- [ ] Recovery code save confirmation olmadan setup tamamlandı sayılmasın.
- [ ] Privileged page native admin sözü vermesin; secure web handoff, reason ve retry sun.
- [ ] Keyboard open, small screen ve Dynamic Type %200 source/layout checks ekle.
- [ ] Auth-flow test + typecheck; PASS bekle.
- [ ] Commit: `feat: unify Earnica native auth surfaces`.

## Task MOB-07: Member Overview'u Live Value + Next Action Olarak Yenile

**Files:**

- Modify: `apps/mobile/app/(tabs)/index.tsx`
- Modify: `apps/mobile/src/components/NextActions.tsx`
- Create: `apps/mobile/src/components/LiveValueRail.tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Create: `apps/mobile/test/member-surfaces.cjs`

- [ ] Source contract testte readiness summary, one dominant action, earned/maturing/payable/requested/processing/settled currency values, status-unavailable, loading/error/empty/stale ve no card grid expectations yaz; raw `paid` label bekleme ve FAIL bekle.
- [ ] Home hierarchy: context/title → readiness/next action → live value rail → compact level evidence.
- [ ] API response currency groups ayrı; BigInt-safe renderer kullan.
- [ ] Pull-to-refresh authority; local refresh success without server response göstermeme.
- [ ] Member-surface test + typecheck; PASS bekle.
- [ ] Commit: `feat: redesign Earnica mobile home`.

## Task MOB-08: Mobile Payout Readiness ve Lifecycle Mapper'ını Kur

**Files:**

- Create: `apps/mobile/src/lib/payouts.ts`
- Create: `apps/mobile/src/components/PayoutReadiness.tsx`
- Create: `apps/mobile/src/components/PayoutLifecycle.tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Modify: `apps/mobile/test/member-surfaces.cjs`

- [ ] Testte ready/blocked/unknown; native/verified-web/external-provider/support remediation; earned/maturing/payable/requested/under-verification/approved/processing/issued/mailed/settled/cleared/held/rejected/failed/reversed/status-unavailable, timestamp/currency ve event-authority expectations yaz; FAIL bekle.
- [ ] Mapper P0 stable reason/status code'larını native presentation'a çevirsin; raw message switch yapma.
- [ ] Unknown gate'i asla ready gösterme; support/refresh veya not-configured state'i sun. Yalnız master'daki unknown-compliance hard-block onayı verilirse `requestable:false`/blocker uygula; onay yoksa mevcut server request behavior'ını koru ve acceptance'ı BLOCKED bırak.
- [ ] Lifecycle event authority yoksa finance action disabled.
- [ ] Issued/Mailed/Cleared yalnız canonical DTO `authority:'event-log'` ile destekleniyorsa görünür; legacy snapshot veya client tahminiyle üretme.
- [ ] Test + typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica native payout presentation`.

## Task MOB-09: Wallet Route'unu Readiness-First Yap

**Files:**

- Modify: `apps/mobile/app/(tabs)/wallet.tsx`
- Modify: `apps/mobile/src/components/PayoutReadiness.tsx`
- Modify: `apps/mobile/src/components/PayoutLifecycle.tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Modify: `apps/mobile/test/member-surfaces.cjs`

- [ ] Testte balance → readiness → action → active lifecycle → history order, request revalidation, offline disable ve terminal result expectations yaz; FAIL bekle.
- [ ] Payout request server readiness'i submit'te yeniden doğrulasın; blocker action alanında kalıcı gösterilsin.
- [ ] Offline/stale state financial values'ı stale timestamp ile gösterir; mutation kapalı ve retry açık.
- [ ] History member-safe DTO dışında recipient/evidence göstermesin.
- [ ] Test + typecheck; PASS bekle.
- [ ] Commit: `feat: rebuild Earnica mobile wallet`.

## Task MOB-17: Mobile Auth ve Readiness Remediation Router'ını Fail-Closed Yap

**Dependencies:** P0-08, P0-11, MOB-06, MOB-08, MOB-09.

**Files:**

- Modify: `apps/mobile/app/login.tsx`
- Modify: `apps/mobile/src/lib/api.ts`
- Create: `apps/mobile/src/lib/remediation.ts`
- Modify: `apps/mobile/src/components/PayoutReadiness.tsx`
- Create: `apps/mobile/test/remediation-contracts.cjs`

- [ ] Source contract testte forgot/reset login erişimi, email verification universal/web fallback, native route allowlist, short-lived external-provider expiry, support reason ve no credential/token-in-URL beklentilerini yaz; FAIL bekle.
- [ ] Native forgot/reset route'u olmadığı için login'den yalnız server/config verified allowlist içindeki HTTPS web flow'a git; return target credential/token içermez.
- [ ] Email verification target universal/app handler varsa onu, yoksa verified HTTPS web fallback'i kullanır; current session'a dönüşte server readiness refetch edilir.
- [ ] Address/payment native route'u kaynakta bulunmadığı sürece `native` target uydurma; typed unavailable/support göster ve acceptance'ı BLOCKED bırak.
- [ ] KYC yalnız server-issued `external-provider` session URL + `expiresAt` ile açılır; kaynak bulunmadığı sürece provider URL/brand uydurma. Expired/resume durumunda yeni server target iste.
- [ ] Fraud/sanctions self-service değilse owner + safe reason category + support target göster; hassas risk kuralını sızdırma.
- [ ] `node apps/mobile/test/remediation-contracts.cjs` ve mobile lint; PASS bekle.
- [ ] Commit: `fix: route mobile remediation safely`.

## Task MOB-10: Team Surface'i Compact Aggregate Workspace Yap

**Files:**

- Modify: `apps/mobile/app/(tabs)/team.tsx`
- Create: `apps/mobile/src/components/LevelSummary.tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Modify: `apps/mobile/test/member-surfaces.cjs`

- [ ] Testte aggregate privacy, active/total counts, no individual sale/name leakage, empty/error/retry ve large-text wrap expectations yaz; FAIL bekle.
- [ ] Nested cards yerine compact level rows/trace hierarchy uygula.
- [ ] Nudge yalnız gerçek invite action'ına bağlansın; dekoratif chart ekleme.
- [ ] Small screen ve Dynamic Type %200'de labels/values/action kaybolmasın.
- [ ] Test + typecheck; PASS bekle.
- [ ] Commit: `feat: refine Earnica mobile team`.

## Task MOB-18: Mobile Direct Recruit Search ve Detail Akışını Ekle

**Dependencies:** ME-12 API contract'ı.

**Files:**

- Modify: `apps/mobile/app/(tabs)/team.tsx`
- Create: `apps/mobile/src/components/DirectRecruitList.tsx`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Modify: `apps/mobile/test/member-surfaces.cjs`

- [ ] Source contract testte server q/status/page query, pull-to-refresh, list→detail, safe direct fields, loading/error/empty/retry ve no deeper-downline/sale leakage beklentilerini yaz; FAIL bekle.
- [ ] Direct recruit person/readiness/invite outcome list'ini aggregate level summary'nin önüne koy; search/filter anlamını web ile eşleştir.
- [ ] Detail bottom sheet yalnız allowlisted API fields'ı gösterir; email, sales amount veya risk-rule detail çıkarmaz.
- [ ] Search/filter/page değişiminde stale response'u iptal/ignore et; offline durumda last-known list'i açık stale etiketiyle read-only göster.
- [ ] Dynamic Type %200, TalkBack ve küçük ekran list→detail focus/back davranışını source/native gate'e ekle.
- [ ] Test + typecheck; PASS bekle.
- [ ] Commit: `feat: add Earnica mobile direct recruits`.

## Task MOB-11: Invite Creation/Share Surface'ini Tamamla

**Files:**

- Modify: `apps/mobile/app/(tabs)/invite.tsx`
- Create: `apps/mobile/src/components/InviteSharePanel.tsx`
- Modify: `apps/mobile/src/lib/api.ts`
- Modify: `apps/mobile/src/lib/i18n.ts`
- Modify: `apps/mobile/test/member-surfaces.cjs`

- [ ] Testte stable Idempotency-Key, real QR, share/copy, cancel-not-error, expiry/status ve trust message expectations yaz; FAIL bekle.
- [ ] Native share cancel'i failure toast olarak gösterme; completed/cancelled ayrı sonuç.
- [ ] Invite creation retry aynı payload/key; payload change/success yeni key.
- [ ] Earnica system trust + tenant identity + inviter context birlikte görünür.
- [ ] Test + typecheck; PASS bekle.
- [ ] Commit: `feat: complete Earnica mobile invite center`.

## Task MOB-12: Background/Resume ve Offline Financial Safety'yi Ortaklaştır

**Files:**

- Modify: `apps/mobile/src/lib/api.ts`
- Modify: `apps/mobile/src/lib/auth.ts`
- Modify: `apps/mobile/app/_layout.tsx`
- Modify: `apps/mobile/app/(tabs)/wallet.tsx`
- Create: `apps/mobile/test/lifecycle-safety.cjs`

- [ ] Source contract testte AppState resume session refresh, MFA/assurance expiry, stale financial state, request cancellation ve no offline mutation expectations yaz; FAIL bekle.
- [ ] Foreground resume'da server session/assurance refresh et; failed refresh safe login veya stale readonly state'e gider.
- [ ] In-flight screen requests unmount/background'da cancel/ignore; stale response yeni tenant/session'a yazılmaz.
- [ ] Wallet offline'da last-known data timestamp + stale label; payout action disabled.
- [ ] Test + typecheck; PASS bekle.
- [ ] Commit: `fix: harden Earnica mobile lifecycle safety`.

## Task MOB-13: Native Asset ve Route Regression Setini Kapat

**Files:**

- Modify: `apps/mobile/test/theme-architecture.cjs`
- Modify: `apps/mobile/test/mfa-policy.cjs`
- Modify: `apps/mobile/test/auth-flows.cjs`
- Modify: `apps/mobile/test/member-surfaces.cjs`
- Modify: `apps/mobile/test/lifecycle-safety.cjs`

- [ ] Bütün visible old brand imports/copy, Number(cents), raw status invention, ASCII/emoji icons ve unsupported admin route assertions ekle.
- [ ] Production owner task'ları tamamlandıktan sonra auth/invite/readiness/lifecycle/tab/large-text/reduced-motion assertions'ını genişlet; herhangi bir test FAIL ise ilgili owner task'ı yeniden aç, bu regression task'ında production code değiştirme.
- [ ] Beş Node testini tek tek çalıştır; PASS bekle.
- [ ] `pnpm.cmd --filter @refearn/mobile lint`.
- [ ] `pnpm.cmd --filter @refearn/mobile export:check`.
- [ ] Commit: `test: cover Earnica native contracts`.

## Task MOB-14: Android Native Checkpoint'ini Doğrula

**Files:**

- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] Android minimum/latest emulator matrisine ek olarak en az bir fiziksel Android cihaz için API URL'yi approved runtime mechanism ile ayarla; `.env` dosyası değiştirme. Yalnız emulator sonucu mobile release gate'i geçirmez.
- [ ] Önce mevcut installable dev/preview build, EAS project ID ve physical device erişimini doğrula. Bunlar yoksa app/deploy config uydurma veya Expo Go sonucunu custom scheme/icon/splash/push kanıtı sayma; gate'i `BLOCKED: physical-installable-build-unavailable` bırak ve ayrı build/config yetkisi iste.
- [ ] Cold/warm deep link, valid/invalid/expired/email-locked invite, login TOTP/recovery, setup, privileged handoff, tab tasks, payout offline/resume görevlerini çalıştır.
- [ ] Installable build üzerinde cold/warm `refearn://i/{code}` compatibility link'i, Earnica alias varsa onu, adaptive icon/splash, native share ve push token/project-ID sonucunu doğrula; provider/project ID yoksa ilgili satırı unresolved bırak.
- [ ] Keyboard overlap, Android back, notification permission, safe area/gesture bar kontrolü.
- [ ] Light/dark, reduced motion, font scaling %200, TalkBack ve small-screen matrisini tamamla.
- [ ] Expo export + mobile lint/tests ile fiziksel cihaz model/OS/build ve deep-link/share/keyboard/TalkBack kanıtını checklist'e yaz; secret/device identifier fazlasını kaydetme.
- [ ] Başarısız/atlanmış kontrolü PASS işaretleme.
- [ ] Commit: `test: verify Earnica Android experience`.

## Task MOB-15: iOS Verification Handoff'unu Hazırla

**Files:**

- Create: `docs/superpowers/plans/evidence/earnica-ios-verification.json`
- Modify: `tasks/earnica-full-product-redesign-todo.md`

- [ ] JSON matrix'e universal/custom deep link, KeyboardAvoidingView, background session, VoiceOver, Reduce Motion, Dynamic Type, safe area/home indicator ve notification prompt görevlerini yaz.
- [ ] Windows'ta iOS Simulator çalıştırılmış gibi kanıt üretme.
- [ ] Mac/Xcode, physical device veya approved EAS build sonucu yoksa her satırı `unresolved` ve owner/next command ile bırak.
- [ ] Gerçek sonuç sağlanırsa device/OS/build id ve PASS/FAIL evidence link/path ekle.
- [ ] Checklist'te iOS'u unresolved ise mobile overall complete işaretleme.
- [ ] Commit: `docs: prepare Earnica iOS verification handoff`.

## Mobile Exit Criteria

- Visible app identity Earnica; internal package/scheme compatibility korunur.
- Light/dark semantic tokenlar web meaning'iyle eşleşir; old glow/card-heavy visual yoktur.
- Login/invite MFA challenge credentials'ı kapatır, expiry/restart/recovery semantics'i doğrudur.
- Invite consent server contract'ına uyar.
- Forgot/reset ve email verification safe verified-web/universal fallback kullanır; unavailable address/payment/KYC/fraud/sanctions source'ları uydurulmaz.
- Home/Wallet/Team/Invite task'ları readiness/lifecycle authority'sini kullanır ve BigInt/currency safe'tir.
- Background/offline financial mutation kapalı; stale state açık.
- Android emulator matrisi ve en az bir fiziksel Android kanıtlıdır; iOS kanıt yoksa açık unresolved'dır.
