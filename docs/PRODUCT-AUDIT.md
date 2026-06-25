# Refearn — Strategic Product Audit

> Scope: the **real** product in this repo — a multi-tenant **referral/commission + payout SaaS** for
> cabinet / home-improvement companies (US market). NOT a moving/address-change app. Grounded in the
> actual codebase + a live end-to-end walkthrough (login → members → sales → commission → payouts →
> reconcile → periods → member app → public invite). Honest, specific, no flattery.

---

## Executive Summary

Refearn is **further along and more serious than it presents itself.** Under the hood it is a real
financial system: an integer-cent BigInt ledger, a sliding-window commission engine with bonus layers
(fast-start / matching / rank-override), maturation rules, period-lock accounting close, a tamper-evident
audit hash-chain, maker-checker payouts, KYC/fraud/OFAC gates, self-hosted ACH/NACHA file generation, and
1099-NEC reporting. That is **infrastructure-grade plumbing** most "MLM software" and every spreadsheet
lack.

But the product **wears a checklist-app coat over an infrastructure body.** The promise isn't crisp, the
first-run is empty and unguided, the dashboard reports numbers instead of driving the next action, and the
two parties who must *trust* it — the **company paying** and the **rep getting paid** — aren't given enough
proof that the money is correct and will arrive. There is also **no visible billing/monetization layer**
in the codebase: it can run a commission program but can't yet charge for it.

The opportunity is to stop competing as "a nicer commission tracker" and own a category:
**"the system of record for referral commissions and payouts in referral-driven home-services businesses"** —
the ledger + compliance + payout rails that make a referral program *auditable and bankable*, not just
*trackable*. The strongest moat is the money/compliance layer (correct ledger, period close, 1099, ACH,
audit chain), which is exactly where competitors are weakest and switching costs are highest.

**Verdict:** this is the beginning of a real SaaS — arguably a small infrastructure company — being
under-sold as a utility. The work to reach the next level is mostly **clarity, trust, activation, and
monetization**, not more engine features.

---

## Current Product Understanding

What the app *is* today (observed):
- **Tenant (cabinet company)** runs a referral/commission program. **Members** (reps/referrers) sit in a
  **sponsor tree** (ltree path). **Team leaders** can root sub-trees.
- A sale is **recorded** (draft) → **approved** (commission distributes up the tree into the ledger) →
  optionally **delivered** (maturation) → **payable** → **paid out**.
- **Commission engine:** unilevel ladder capped by a pool rate, plus synthetic bonus levels (fast-start
  1000, matching 1001, rank-override 1002), compression / inactive-earn toggles. Money is BigInt cents;
  a runtime invariant caps total distribution.
- **Payout pipeline:** payable list → run (or maker-checker proposal) → KYC/fraud/OFAC gates → self-hosted
  NACHA/ACH file + CSV → bank reconciliation → cleared. Members can self-request payouts.
- **Accounting/compliance:** monthly summaries, **period lock** (close), **audit hash-chain** (seal/verify),
  clawback/negative-balance report, **1099-NEC** export, financial-invariant verifier.
- **Admin surface:** members, sales, payouts, plans, campaigns (leaderboards + prizes), ranks, periods,
  audit, settings (general, roles/RBAC, brand, integrations = API keys + webhooks, notifications, reports,
  announcements), platform (cross-tenant, platform_admin).
- **Member app:** wallet (sold vs earned, request payout), my sales, team (aggregate downline), invite,
  announcements. **Public:** invite landing `/i/[code]`.

What it appears to be at first glance: a tidy "track commissions + pay people" tool. What it actually is:
**a commission ledger + payout/compliance engine** with a thin app on top.

Ideal user (today): the **owner/finance admin of a referral-driven cabinet/home-improvement company** who
pays reps/affiliates and is tired of spreadsheets, disputes, and 1099 season. Secondary: the **rep** who
wants to see "what did I earn and when do I get paid."

Emotional state: the admin is **anxious about correctness and compliance** (am I paying the right amount?
will the math survive an audit / the IRS?). The rep is **skeptical and impatient** (is this real money? when
do I get it?). The product must convert anxiety → confidence and skepticism → trust. Right now it mostly
*stores* and *computes*; it under-delivers on *reassurance*.

---

## Biggest Problems

1. **The promise is fuzzy.** Nothing on first contact says, in one line, "Refearn is the commission ledger
   and payout system for your referral program — provably correct, IRS-ready, paid out automatically."
2. **Cold start / no activation path.** A fresh tenant lands on an empty dashboard ($0 everywhere) with no
   guided setup ("import your reps → set your plan → record your first sale → see commission flow"). I had
   to seed data to make the product *do* anything. Time-to-first-value is effectively undefined.
3. **The dashboard reports, it doesn't drive.** It shows revenue/commission/effective-rate/members — but
   not "what needs your attention now" (sales awaiting approval, payouts to run, members near a payout
   threshold, period ready to close, failed webhooks). It's a scoreboard, not a command center.
4. **Trust is under-built for a money product.** The rep has no clear "you will be paid on X, here's the
   proof" story; the admin has powerful correctness machinery (audit chain, financial verifier) that is
   **buried** instead of being a visible trust badge. Sensitive data handling (bank/SSN) isn't explained
   to the user in-product.
5. **No monetization layer.** There's no tenant billing/subscription/paywall in the codebase. The product
   can run programs but can't charge for them, and there's no "value moment → upgrade" design.
6. **Inconsistent polish.** Some screens are clean (tree, dashboard); others are dense/cramped (modals at
   narrow widths, busy tables) and there's no real mobile/responsive story for admins. No PWA/offline until
   just now. (Member app is the surface most likely to be used on a phone and was least app-like.)
7. **Reporting inconsistencies erode trust precisely where it matters** — e.g. the dashboard commission KPI
   recently disagreed with the analytics chart after a void (now fixed). In a money product, a number that
   disagrees with itself is a credibility wound.

---

## Biggest Opportunities

1. **Reposition from "tracker" to "system of record + payout rails."** Own *correctness, compliance, and
   getting-people-paid*, not "managing a checklist of commissions."
2. **Make correctness visible.** Surface the audit hash-chain + financial-invariant verifier as a
   first-class **"Books are provably balanced / tamper-evident"** trust panel. This is a genuine moat almost
   no competitor has — show it.
3. **Activation engine.** A guided "set up your program in 10 minutes" flow (import reps, pick/confirm a
   plan, record a sample sale, watch commission flow, send first invites) that gets to first-value fast.
4. **Rep-side trust + virality.** Make the rep wallet a "you earned $X, paid on [date], here's your
   downline" experience worth opening; make inviting frictionless (the invite tree is the growth loop).
5. **Monetization tied to money moved.** Charge for the payout/compliance layer (per active payee, per
   payout volume, or tiers gated on ACH/1099/maker-checker/API) — the parts with the clearest willingness
   to pay.
6. **Become a connector/platform.** API keys + webhooks already exist; the path to an **embeddable
   commission/payout API** (Plaid-like, but for referral commissions + payouts) is real and defensible.

---

## Better Product Vision

Refearn should feel like **"QuickBooks + a payout rail for your referral program."** Not a checklist — a
**ledger you trust and a button that pays everyone correctly.**

Core experience: an admin opens Refearn and within seconds knows (a) **what they owe**, (b) **what needs a
decision**, (c) **that the books are provably correct**, and with one guarded action **pays everyone**. A rep
opens Refearn and instantly sees **what they earned, when it lands, and who's in their team** — and shares an
invite in one tap.

First 5 minutes (new tenant): connect/import reps → confirm a commission plan from a template → record (or
import) a first sale → **watch the commission distribute up the tree in real time** → invite the first reps.
The "aha" is seeing money flow correctly through the tree, not configuring settings.

What the user should trust Refearn to do: **compute every commission correctly, never pay into a closed
period, never double-pay, screen payees for compliance, generate the bank file + 1099s, and prove all of it
with an immutable audit trail.** That trust — backed by machinery that already exists — is the product.

---

## Ideal User Journey (signup → paid)

1. **Land:** a positioning line + 30-second "how it works" (sale → tree → commission → payout) + social proof
   + "see a live demo program" (sandbox tenant).
2. **Sign up (company):** company name, currency (US), choose a plan template (e.g. "5-level unilevel, 10%
   pool"). No blank-canvas config.
3. **Onboard (10-min checklist, dismissible):** import reps (CSV/manual) → confirm plan + payout threshold
   (in dollars) → set maturation/KYC policy → record/import first sales → run a test commission → invite reps.
   Progress bar with a clear "you're live" finish.
4. **Operate (daily):** dashboard command-center → approve sales → run payouts (maker-checker) → reconcile
   bank → answer member questions. Period close monthly with a one-screen checklist (pending matured? books
   verified? 1099s ready?).
5. **Rep journey:** accept invite → see "what you'll earn" → record sales (or get credited) → watch wallet
   grow → request/receive payout → invite more reps (growth loop).
6. **Get paid:** matured → payable → payout run → ACH file → bank → **cleared** → rep sees "Paid $X on
   [date], ref ####" + can download a receipt. Every step visible to both sides.

---

## UI/UX Recommendations (screen-level, grounded)

**Screen / Area: Admin dashboard (`/admin`)**
- Current issue: a passive scoreboard (revenue/commission/effective-rate/members). After actions it doesn't
  point you anywhere; KPIs settle but the page never reaches idle (continuous animation/SSE).
- Why it matters: the admin's job is decisions (approve, pay, close), not reading totals.
- Recommended: a **command center** — top row "needs attention" (sales awaiting approval, payouts to run,
  members above threshold, period ready to close, failed webhooks), then liability ("what you owe": pending
  / payable / in-payout), then a **"Books verified ✓ (chain intact, summaries balanced)"** trust badge, then
  trends. One primary CTA: "Run payouts" / "Close June".
- Expected result: faster operations, higher trust, lower support load. Priority: **High.**

**Screen / Area: First-run / empty states (whole app)**
- Current issue: empty tenant = $0 everywhere, "No rows", no guidance.
- Recommended: a persistent **setup checklist** + rich empty states ("No sales yet — record your first or
  import a CSV" with the action inline). Priority: **High.**

**Screen / Area: Add-member / forms / modals**
- Current issue: modals are fine on desktop but **cramped at narrow/mid widths**; dense forms (sponsor code,
  role, leader checkbox, helper text stacked). Backdrop dim is subtle on the dark theme.
- Recommended: increase modal max-width + breathing room, stronger backdrop, group fields, move helper text
  to inline hints; ensure mobile layout (single column, full-height sheet on small screens). Priority: **Med.**

**Screen / Area: Member wallet (`/app/wallet`)**
- Current issue: shows payable balance + request button — functional but not reassuring.
- Recommended: "You've earned $X this month · $Y lifetime", **"Next payout: [date] (or request now)"**, a
  simple status timeline (earned → matures [date] → payable → paid), and a **payout receipt**. Priority: **High.**

**Screen / Area: Payouts (`/admin/payouts`)**
- Current issue: powerful but dense; reconcile is a paste-box; ACH skipped-payees only surface in a header.
- Recommended: a **"needs attention" queue** (KYC to review, fraud flags, sanctions hits, failed payouts,
  reconcile gaps) above the payable list; show skipped-no-bank-info payees inline before generating ACH.
  Priority: **Med-High.**

**Screen / Area: Tree / Network (`/admin/tree`)**
- Current: clean; leaders landing → scoped subtree works well (verified live).
- Recommended: keep; add per-leader "this month" sparkline + "invite under this leader" action. Priority: **Low.**

**Cross-cutting:** consistent money/date formatting (already mostly good), real loading skeletons, recoverable
error banners (now improved with 401→login + cross-tab logout), modal scroll-lock (just added), and a true
mobile pass for the **member app first** (it's the phone surface).

---

## Feature Recommendations

**A. Must-have (clarity + usefulness)**
- Guided onboarding / setup checklist + sandbox demo program.
- Dashboard "needs attention" command center.
- Visible "Books verified / audit chain intact" trust panel (surface existing machinery).
- Rich empty states + first-run guidance.
- Member payout status timeline + downloadable receipt.

**B. High-leverage (much more valuable)**
- **Tenant billing/subscription** (the missing monetization layer) with a value-moment paywall.
- Bulk reps import + plan templates (faster activation).
- Payout "needs attention" queue (KYC/fraud/sanctions/failed/reconcile) as a single operational inbox.
- Notifications that actually drive behavior (you have payouts to run, period ready to close, member hit
  threshold) — and the currently read-only notification matrix made real.
- Rep growth loop polish: one-tap invite, "what you'll earn" preview, downline milestones.

**C. Trust & compliance**
- In-product privacy/data explanations (what we store of SSN/bank = last-4 + encrypted; who can see it).
- Visible verification states (KYC verified badge, sanctions screened date, period sealed).
- Confirmations + audit visibility on sensitive actions (payouts, role changes, period unlock) — much of
  this exists server-side; surface it to users.
- Live re-screening proof (OFAC re-screen at payout — now implemented; show "screened just now").

**D. Partner / infrastructure (toward a connector platform)**
- Harden + document the **public API** (API keys exist) and webhooks (now SSRF-guarded) into a real
  developer surface (record sale, read commissions, trigger payout) with docs + idempotency keys.
- Embeddable "commission + payout" API for platforms that want to run referral payouts without building a
  ledger — the Plaid-shaped opportunity, but for commissions/payouts.
- Bank/processor adapters beyond self-hosted NACHA (optional ACH processors) as a paid tier.

**E. Avoid for now (distractions)**
- More MLM bonus layer types / exotic comp plans (engine is already rich; diminishing returns).
- A second product context (e.g. moving/address-change) — different product, don't dilute.
- Heavy gamification beyond the existing campaigns/ranks until activation + trust are solved.
- Native mobile apps before the member **PWA** + responsive pass are done.

---

## Dashboard Redesign Concept

A **command center**, three bands:
1. **Needs attention (action chips):** "{n} sales awaiting approval", "{$} ready to pay ({m} members)",
   "{n} payout requests", "{n} KYC/fraud to review", "Period {month} ready to close", "{n} failed webhooks".
   Each chip is a one-click route to the queue. Empty = "All clear ✓".
2. **What you owe (liability):** pending (not yet matured) · payable (ready) · in-payout — with a single
   primary CTA ("Run payouts" / "Review batch"). Plus the **trust badge**: "Books verified — audit chain
   intact, ledger == summaries (checked [time])."
3. **Performance:** revenue / **net** commission (must match analytics) / effective rate / top earners /
   trend — secondary, below the fold of action.

The number-one rule: **every figure agrees with every other view** (the void→KPI bug taught this), and the
dashboard answers "what do I do next?" before "how are we doing?".

---

## Onboarding Redesign Concept

Replace blank-canvas setup with a **10-minute, 5-step guided activation** (progress bar, skippable, resumable):
1. **Company basics** (name, currency, timezone).
2. **Pick a plan template** (e.g. "Unilevel 5×, 10% pool") → preview the ladder with a live simulator
   (the plan simulator already exists — use it here).
3. **Add your reps** (CSV import or a few manual) → builds the first tree.
4. **Record a first sale** (or import) → **watch commission distribute up the tree live** (the aha moment).
5. **Invite reps + set payout policy** (threshold in dollars, maturation, KYC on/off) → "You're live."

Onboarding should *demonstrate the engine*, not configure it. End on a populated dashboard, not an empty one.

---

## Mobile App Recommendations

The **member app is the phone surface** — prioritize it:
- Make it an **installable PWA** (now wired) with an offline shell + friendly offline state (done) — reps
  check earnings on the go.
- Mobile-first layouts for wallet / sales / team / invite (single column, big tap targets, bottom nav).
- **One-tap invite + share sheet** (growth loop) and push notifications for "commission earned" / "payout
  sent."
- Record-a-sale flow optimized for thumbs (seller is *you*, amount, done).
- Admin mobile is secondary — at least make payouts/approvals usable on a phone for urgent actions.

(There is also an `apps/mobile` Expo project — decide: invest in the PWA *or* the native app, not both half-way.
For speed and reach, the PWA is the higher-leverage near-term bet.)

## Admin Panel Recommendations

Admin already covers a lot; make it **operational, not just navigable**:
- A unified **operations inbox** (sales to approve, payouts to run, KYC/fraud/sanctions to clear, failed
  webhooks, reconcile gaps) — the admin's daily home.
- **Period close** as a guided checklist (matured? books verified? 1099s ready? → seal).
- **Member 360** (already strong) + quick actions (impersonate read-only, adjust, message).
- **System health** (scheduler last-run, webhook delivery health, financial-verifier status, sanctions list
  freshness) — surface the cron/health that exists in code.
- Clear **role-scoped** views (owner vs admin vs staff) and the RBAC escalation guards (now hardened) made
  legible in the UI.

## Subscription & Monetization Recommendations

Today: **no billing exists.** That's the biggest commercial gap. Recommendation:
- **Why they pay:** to *pay reps correctly and compliantly without a bookkeeper* — the payout + 1099 + audit
  layer is the willingness-to-pay center, not "tracking."
- **Value moment to gate:** the first time they **run a real payout** / **generate a 1099 / ACH file** /
  **need maker-checker or the API**. Free: track commissions + small tree. Paid: payouts at scale, ACH/1099,
  maker-checker, API/webhooks, advanced compliance.
- **Pricing shape:** per **active payee/month** or **% of payout volume** (aligns price with value and money
  moved), with tiers (Starter / Growth / Compliance/Enterprise). Avoid pure seat pricing — value scales with
  payees and dollars, not admins.
- **Who else pays:** platforms/agencies that want to embed commission+payout (API tier); enterprises wanting
  SSO, advanced audit, SLAs.

## Trust, Privacy, and Compliance Recommendations

Because Refearn handles bank + tax-ID + money, trust is the product:
- **Explain data handling in-product:** "We store only the last 4 of SSN/account; full account numbers are
  encrypted for the bank file and never shown." (The encryption + last-4 design exists — say so.)
- **Make verification visible:** KYC verified badge + date, "sanctions screened [time]" (live re-screen now
  exists), period "sealed" state, "books balanced ✓".
- **Surface the audit trail to users** (who changed a role, who ran a payout, who unlocked a period) — the
  hash-chained log exists; give admins a readable, filterable history (it's there — elevate it).
- **Confirm sensitive actions** with clear consequences (payout = money leaves; period unlock = books reopen).
- **Security posture page:** encryption at rest, fail-closed prod key (now enforced), SSRF-guarded webhooks,
  RBAC, maker-checker, OFAC — turn the audit fixes into a *trust marketing asset*.

## Technical / Product Alignment

Where the architecture **supports** the vision:
- BigInt-cent ledger, period locks, audit hash-chain, maker-checker, OFAC/KYC/fraud, NACHA/1099, financial
  verifier, RBAC, multi-tenant isolation, API keys + webhooks, SSE live updates. This is a strong, honest
  foundation — most of the hard money/compliance work is done and now security-hardened (56-finding audit
  remediated, regression-tested).

Where it **blocks / lags** the vision:
- **No billing/subscription layer** — can't monetize yet.
- **Activation/onboarding** is code-thin — high TTV.
- **Reporting source-of-truth discipline** needs a pass (one KPI already diverged; standardize on
  monthly_summaries as the netted truth everywhere).
- **Mobile/PWA/offline** only just added; member mobile UX is immature.
- **Notifications/automation** partly inert (read-only matrix); the proactive layer that drives retention is
  underbuilt.
- Two surfaces (web PWA vs `apps/mobile`) risk split investment.

## Roadmap

**Phase 1 — Clarity & trust (activate what exists).**
Goal: crisp promise, fast first-value, visible correctness. Work: positioning + landing, guided onboarding +
sandbox, dashboard command-center, surface audit-chain/financial-verifier trust panel, rich empty states,
member wallet payout-status + receipt, finish responsive/PWA for the member app, standardize netted KPIs.
Impact: high (activation + trust). Risk: low. Difficulty: med. Priority: **P0.**

**Phase 2 — Value & retention.**
Goal: people come back and the program runs itself. Work: operations inbox (approve/pay/clear/reconcile),
proactive notifications (real matrix), period-close checklist, rep growth-loop polish, bulk import + plan
templates. Impact: high (retention). Risk: low-med. Difficulty: med. Priority: **P1.**

**Phase 3 — Monetization.**
Goal: charge for the money/compliance layer. Work: tenant billing + plans + value-moment paywall (gate
ACH/1099/maker-checker/API/scale), usage metering (payees/volume). Impact: very high (revenue). Risk: med.
Difficulty: med-high. Priority: **P1.**

**Phase 4 — Provider/payout intelligence.**
Goal: reduce payout friction + compliance load. Work: ACH processor adapters, smarter reconciliation
(auto-match, partials), sanctions/KYC automation, 1099 e-file, clawback automation. Impact: high (stickiness).
Risk: med-high (banking/compliance). Difficulty: high. Priority: **P2.**

**Phase 5 — Connector / API platform & enterprise.**
Goal: become the embeddable commission+payout layer. Work: public API + docs + idempotency, embeddable
flows, SSO/SAML, advanced audit/SLAs, white-label. Impact: very high (category). Risk: high. Difficulty: high.
Priority: **P2-P3.**

## Top 20 Action Items

1. Write a one-line product promise + landing that says "commission ledger + automatic, compliant payouts."
2. Build a 10-minute guided onboarding (company → plan template → import reps → first sale → invite).
3. Ship a sandbox/demo program so a new tenant can *see* the engine before configuring.
4. Redesign the dashboard into a **needs-attention command center** with one primary CTA.
5. Add a visible **"Books verified — chain intact, ledger == summaries"** trust badge (surface existing code).
6. Standardize all money KPIs on `monthly_summaries` (netted) so no two views disagree (extend the fix).
7. Rich empty states everywhere with an inline first action.
8. Member wallet: payout-status timeline + "next payout date" + downloadable receipt.
9. Make the member app an installable PWA (done) + a real mobile-first responsive pass.
10. One-tap rep invite + share sheet + "what you'll earn" preview (growth loop).
11. Build the **operations inbox** (sales to approve / payouts to run / KYC-fraud-sanctions / failed / reconcile).
12. Make notifications proactive + the read-only routing matrix real.
13. Add a **period-close checklist** screen (matured? verified? 1099s? → seal).
14. **Tenant billing + subscription** with a value-moment paywall (the missing monetization layer).
15. Usage metering by active payees / payout volume to power pricing.
16. In-product privacy/data explanation (last-4 + encrypted account; who sees what).
17. Show verification states (KYC verified, sanctions screened time, period sealed) across the UI.
18. Surface the audit log to admins as a readable, filterable history (it exists — elevate it).
19. Harden + document the public API (record sale / read commissions / trigger payout) with idempotency.
20. Decide PWA vs native (`apps/mobile`) and commit to one; finish the responsive/visual defect pass.

## Final Founder-Level Opinion

This is **not a small checklist app.** It's a **serious financial SaaS with the bones of an infrastructure
company** — a correct ledger, real payout rails, and compliance machinery that took genuine engineering and
is now security-hardened. That's the hard, rare part, and it's largely done.

What it is **not yet**: a product that *communicates* that value, *activates* a new customer fast, *reassures*
both sides that the money is correct and arriving, or *charges* for any of it. Today it can run a commission
program; it can't yet win, keep, or bill a customer on purpose.

To reach the next level, stop adding engine depth and start converting the existing infrastructure into
**clarity, trust, activation, and revenue**: a sharp promise, a 10-minute "watch money flow up the tree"
onboarding, a dashboard that drives the next action, a visible "your books are provably correct" trust
story, a member experience worth opening on a phone, and a billing model priced on payees/volume. Do that,
and Refearn moves from "a nice commission tracker" to **the commission-and-payout system of record for
referral-driven businesses** — with a real moat in the money/compliance layer competitors won't easily copy.
The plumbing earns the right to that ambition; the product just has to claim it.
