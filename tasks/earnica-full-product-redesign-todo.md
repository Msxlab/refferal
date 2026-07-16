# Earnica Full-Product Redesign Checklist

Kaynak spec: `docs/superpowers/specs/2026-07-16-earnica-full-product-redesign-design.md`

Master plan: `docs/superpowers/plans/2026-07-16-earnica-full-product-redesign-master.md`

## Onay Kapıları

- [x] Tasarım yönü ve Earnica marka kararı onaylandı.
- [x] Uçtan uca tasarım spesifikasyonu onaylandı.
- [ ] Teknik implementation plan seti kullanıcı tarafından onaylandı.
- [ ] Invite consent, bulk idempotency ve NPS dismissal additive Prisma migration'ları açıkça onaylandı.
- [ ] Backward-incompatible/versioned API cutover ve unknown compliance hard-block davranışı açıkça onaylandı veya ilgili acceptance BLOCKED kabul edildi.
- [ ] Full payout event/provider authority genişletilmediği sürece Under verification/Approved/Held/Issued/Mailed/Cleared/Reversed state'lerinin BLOCKED kalacağı açıkça kabul edildi.
- [ ] Member self-service `Record sale` business rule/API capability değişikliği açıkça onaylandı veya task BLOCKED kabul edildi.
- [ ] Final path-based Earnica SVG için approved vector/design source aracı sağlandı veya asset gate BLOCKED kabul edildi.
- [ ] Recommended 5-minute fresh step-up security policy açıkça onaylandı veya koşullu task'lar BLOCKED olarak kabul edildi.
- [ ] Altı versioned acceptance frame'i kullanıcı tarafından ayrıca görsel olarak onaylandı; onaydan önce route implementation başlamadı.
- [ ] Task hedefindeki pre-existing untracked dosyalar için yalnız gerekli olduğunda exact dosya bazında adoption/stage onayı alındı; blanket adoption yapılmadı.
- [ ] Playwright/direct browser automation için kullanıcı izni alındı.

## Checkpoint 0 — P0 Data Contracts

Plan: `docs/superpowers/plans/2026-07-16-earnica-p0-data-contracts.md`

- [ ] P0-01 Authority matrix'i çalıştırılabilir kanıta dönüştür.
- [ ] P0-02 Payout batch preview + explicit scope'u fail-closed yap.
- [ ] P0-03 Invite consent kalıcı veri temelini kur. (Migration onayı gerekir.)
- [ ] P0-04 Invite consent'i request/transaction'da zorunlu kıl.
- [ ] P0-05 Invite resolve'u explicit state/privacy contract'a taşı.
- [ ] P0-06 Sales bulk preview ve explicit scope contract'ını kur.
- [ ] P0-07 Bulk mutation replay/partial retry kaydı ekle. (Migration onayı gerekir.)
- [ ] P0-08 Tek payout readiness evaluator'ı kullan.
- [ ] P0-09 Canonical payout lifecycle DTO/non-leak contract'ını kur.
- [ ] P0-10 Capability ve route/tenant contract'ını normalize et.
- [ ] P0-11 Authenticated email verification remediation'ı ekle.
- [ ] P0-12 Fresh step-up server policy'sini ekle. (Security onayına koşullu.)
- [ ] P0-13 Fresh assurance guard contract'ını kur. (Security onayına koşullu.)
- [ ] P0-14 Money/settings mutation'larında fresh assurance enforce et. (Security onayına koşullu.)
- [ ] P0-15 Company governance mutation'larında fresh assurance enforce et. (Security onayına koşullu.)
- [ ] P0-16 Payout batch replay/partial retry'ı kalıcı execution kaydına bağla.
- [ ] P0-17 Member/admin invite idempotency contract'ını zorunlu kıl.
- [ ] P0-18 NPS eligibility + 90 günlük dismissal authority'sini kur. (Migration onayı gerekir.)
- [ ] P0-19 Member Record sale capability policy'sini tanımla. (Ayrı business-rule onayına koşullu.)
- [ ] P0-20 Member self-service Record sale API'sini ekle. (Ayrı business-rule onayına koşullu.)
- [ ] P0-21 P0 API gate'ini fresh evidence ile kapat.

## Checkpoint 1 — Foundation ve Auth

Plan: `docs/superpowers/plans/2026-07-16-earnica-foundation-and-auth.md`

- [ ] FA-01 Gerçek Earnica source artwork'ünü üret ve görsel onayla.
- [ ] FA-02 Web icon/PWA export setini üret.
- [ ] FA-03 Büyük marka exportları ve metadata görsellerini üret.
- [ ] FA-04 Earnica marka runtime contract'ını kur.
- [ ] FA-05 Obsidian + Pearl semantic token sistemini uygula.
- [ ] FA-06 Eksik shadcn/Radix overlay primitive'lerini normalize et.
- [ ] FA-07 Command ve async state primitive'lerini ekle.
- [ ] FA-08 Finansal presentation primitive'lerini BigInt-safe yap.
- [ ] FA-09 Ortak Earnica shell composition'ını kur.
- [ ] FA-10 DecisionWorkspace composition'ını kur.
- [ ] FA-18 İlk dört versioned visual acceptance frame'ini üret.
- [ ] FA-19 HQ/accessibility acceptance frame'lerini tamamla.
- [ ] FA-20 Email/push şablonlarını Earnica kimliğine taşı.
- [ ] FA-21 Payout CSV/export terminolojisini normalize et.
- [ ] FA-22 Route-dışı marka yüzeyi envanterini kanıtla.
- [ ] FA-23 PWA manifest/metadata asset binding'ini ekle.
- [ ] FA-11 Public landing'i Earnica güven yüzeyi olarak yenile.
- [ ] FA-12 Ortak AuthShell ve Login → MFA state machine'ini uygula.
- [ ] FA-13 Forgot-password initiation'ı ekle.
- [ ] FA-14 Verify/reset outcome'larını normalize et.
- [ ] FA-15 MFA enrollment/recovery code akışını tamamla.
- [ ] FA-16 Invite trust/registration state machine'ini uygula.
- [ ] FA-17 Foundation/Auth checkpoint'ini doğrula.

## Checkpoint 2 — Admin Ana Workspace

Plan: `docs/superpowers/plans/2026-07-16-earnica-admin-operations.md`

- [ ] AO-01 Controlled request header contract'ını ekle.
- [ ] AO-02 Typed URL-state foundation'ını kur.
- [ ] AO-03 Admin layout'ı Earnica Operations shell'e taşı.
- [ ] AO-04 Tenant-scoped decision queue API'sini ekle.
- [ ] AO-05 Admin overview'u onaylı Operations Workspace'e dönüştür.
- [ ] AO-06 Admin dashboard multi-currency doğruluğunu sağla.

## Checkpoint 3 — Member Experience

Plan: `docs/superpowers/plans/2026-07-16-earnica-member-experience.md`

- [ ] ME-01 Responsive member shell'i ortak Earnica shell'e taşı.
- [ ] ME-02 Dashboard'a readiness summary authority'si ekle.
- [ ] ME-03 Home'u earned-value workspace olarak yenile.
- [ ] ME-04 Wallet readiness/lifecycle component'lerini kur.
- [ ] ME-05 Wallet route'unu task-oriented workspace'e taşı.
- [ ] ME-06 Email verification remediation'ını kullanılabilir yap.
- [ ] ME-07 Team görünümünü aggregate privacy ile yenile.
- [ ] ME-08 Invite share primitive'lerini kur.
- [ ] ME-09 Invite Center route'unu tamamla.
- [ ] ME-12 Direct recruit query contract'ını privacy-safe yap.
- [ ] ME-13 NPS prompt eligibility'sini lifecycle'a bağla.
- [ ] ME-14 Record sale primary task Sheet'ini uygula. (Ayrı business-rule onayına koşullu.)
- [ ] ME-15 Direct recruit search/filter/detail workspace'ini bağla.
- [ ] ME-10 Member route state/responsive regression'larını kapat.
- [ ] ME-11 Member checkpoint'ini görsel/görev bazlı doğrula.

## Checkpoint 3B — Admin Operations

Plan: `docs/superpowers/plans/2026-07-16-earnica-admin-operations.md`

- [ ] AO-07 Sales list state'ini URL/Decision Desk'e taşı.
- [ ] AO-08 Sales bulk preview/scope UI'sini bağla.
- [ ] AO-09 Sales Import Wizard'ı evidence-first yap.
- [ ] AO-10 Members Workspace'ini URL/idempotent invite'a taşı.
- [ ] AO-25 Admin network query'sini bounded metadata contract'ına taşı.
- [ ] AO-11 Network Explorer'ı controlled/accessible yap.
- [ ] AO-12 Payout operations summary ve paginated queue API'lerini ekle.
- [ ] AO-13 Payout queue/inspector component'lerini ayır.
- [ ] AO-14 Payout route'unu Decision Workspace'e taşı.
- [ ] AO-15 Payout detail masking/evidence sınırını kur.
- [ ] AO-16 Legacy currency mismatch'lerini batch dışında tut.
- [ ] AO-17 Audit response sanitizer'ını ekle.
- [ ] AO-18 Server-backed audit search/read-only inspector'ı uygula.
- [ ] AO-19 Settings IA/permission-aware form sözleşmesini kur.
- [ ] AO-20 Data-status response'undan host path bilgisini kaldır.
- [ ] AO-21 People & Roles decision flow'unu yenile.
- [ ] AO-22 Brand/Security/Notifications/Plans settings yüzeylerini normalize et.
- [ ] AO-23 Admin route contract regression setini kapat.
- [ ] AO-24 Admin checkpoint'ini uçtan uca doğrula.

## Checkpoint 4 — HQ Experience

Plan: `docs/superpowers/plans/2026-07-16-earnica-hq-experience.md`

- [ ] HQ-01 Platform layout'ı Earnica HQ shell'e taşı.
- [ ] HQ-02 Company directory query contract'ını server-side yap.
- [ ] HQ-03 HQ portfolio table/URL-state'i uygula.
- [ ] HQ-04 Company inspection response'unu bounded/currency-safe yap.
- [ ] HQ-05 Company inspection'ı Overview/Network/Governance workspace'e taşı.
- [ ] HQ-06 Suspend/Reactivate governance contract'ını güçlendir.
- [ ] HQ-07 HQ route/currency regression setini kapat.
- [ ] HQ-08 HQ checkpoint'ini uçtan uca doğrula.

## Checkpoint 4B — Native Mobile

Plan: `docs/superpowers/plans/2026-07-16-earnica-mobile-experience.md`

- [ ] MOB-01 Mobile visible metadata/in-app Earnica mark'ını bağla.
- [ ] MOB-16 Native app icon/adaptive foreground/splash setini üret.
- [ ] MOB-02 Native token/primitive sistemini kur.
- [ ] MOB-03 Root/tab shell'i Earnica hiyerarşisine taşı.
- [ ] MOB-04 Ortak MFA Challenge panel/state machine'ini ekle.
- [ ] MOB-05 Mobile invite trust/consent contract'ını bağla.
- [ ] MOB-06 Auth/MFA setup/privileged handoff görsel ailesini kur.
- [ ] MOB-07 Member overview'u live value/next action olarak yenile.
- [ ] MOB-08 Mobile payout readiness/lifecycle mapper'ını kur.
- [ ] MOB-09 Wallet route'unu readiness-first yap.
- [ ] MOB-17 Mobile auth/readiness remediation router'ını fail-closed yap.
- [ ] MOB-10 Team surface'i compact aggregate workspace yap.
- [ ] MOB-18 Mobile direct recruit search/detail akışını ekle.
- [ ] MOB-11 Invite creation/share surface'ini tamamla.
- [ ] MOB-12 Background/resume/offline financial safety'yi ortaklaştır.
- [ ] MOB-13 Native asset/route regression setini kapat.
- [ ] MOB-14 Android native checkpoint'ini doğrula.
- [ ] MOB-15 iOS verification handoff'unu hazırla.

## Checkpoint 5 — Verification ve Rollout

Plan: `docs/superpowers/plans/2026-07-16-earnica-verification-and-rollout.md`

- [ ] VR-01 Acceptance evidence ledger'ını oluştur.
- [ ] VR-02 Full static/test/build matrix'ini çalıştır.
- [ ] VR-03 Browser automation izin kapısını aç.
- [ ] VR-04 Public/Auth browser görevlerini çalıştır.
- [ ] VR-05 Member browser görevlerini çalıştır.
- [ ] VR-06 Admin/HQ browser görevlerini çalıştır.
- [ ] VR-07 Reference-based visual acceptance'ı yap.
- [ ] VR-08 Responsive boundary matrix'ini kapat.
- [ ] VR-09 Accessibility matrix'ini kapat.
- [ ] VR-10 Performance lab matrix'ini çalıştır.
- [ ] VR-11 Native verification sonuçlarını birleştir.
- [ ] VR-12 User-visible brand/terminology sweep yap.
- [ ] VR-13 Bağımsız code review/quality audit'i çalıştır.
- [ ] VR-14 Rollback/release sınırını doğrula.
- [ ] VR-15 Verification-before-completion final gate'ini çalıştır.

## Intentionally Unchanged

- [ ] `tasks/plan.md` ve `tasks/todo.md` okunmadı/değiştirilmedi.
- [ ] `.env*`, deployment/DNS/production config değiştirilmedi.
- [ ] `package.json`/lockfile ve yeni dependency değiştirilmedi.
- [ ] İç `@refearn/*` package adları, storage key'leri ve migration geçmişi toplu rename edilmedi.
- [ ] Komisyon motoru/formüller ve yeni payment provider eklenmedi.
- [ ] Native admin/HQ route seti eklenmedi.
