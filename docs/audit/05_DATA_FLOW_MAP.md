# Data Flow Map

## Invite To Registration

1. Active member creates an invite through `/v1/app/invites`.
2. Public client resolves code through `/v1/invites/:code`.
3. Invitee registers through `/v1/auth/register-by-invite`.
4. User, membership, tenant linkage, and refresh/session context are created.
5. Email verification notification is queued.

Gaps: invite revoke is not exposed, `openedAt`/funnel tracking is absent, and public resolve returns inviter name.

## Sale To Commission

1. Admin/staff creates or imports sale.
2. Sale can be draft or approved.
3. Approval calls `EngineService.approveSale`.
4. Engine locks sale, resolves plan by sale date, computes chain, inserts ledger entries, bumps monthly summaries, queues notifications, and audits action.
5. Maturity rule decides whether ledger starts payable or pending.
6. Scheduled maturity job moves due pending rows to payable.

Strengths: integer cents, bps math, idempotent commission application, transaction grouping, deadlock retry, summary month freeze.

## Void And Reversal

1. Admin voids sale.
2. Engine locks existing commission rows.
3. Reversal rows are inserted with opposite amount.
4. Non-paid originals are marked reversed.
5. Paid rows create payable negative reversals for future clawback.
6. Summaries and notifications are updated in the same transaction.

Strength: append-style accounting model aligns with financial traceability.

## Payout

1. Member can create a payout request for the current tenant month.
2. Admin sees payable members and requested payouts.
3. Admin run or request approval calls `EngineService.payoutMember`.
4. Engine locks all payable rows for the member, nets positives and reversals, checks minimum, creates/updates payout, marks rows paid, moves summaries payable to paid, notifies, and audits.

Gap: the `period` attached to a payout is used on the payout/request record, but payable ledger selection is not period-filtered. This may be intentional "pay all payable balance" behavior, but the product copy and exports should make it explicit.

## Auth And Session

1. Login validates credentials with Argon2 and timing-equal dummy path.
2. If required, login returns MFA challenge.
3. Successful auth creates access/refresh tokens.
4. Refresh rotates token and detects reuse.
5. Guard rehydrates membership and permissions from database.
6. Clients store session locally.

Gap: web uses `localStorage`, mobile uses `AsyncStorage`; both are convenient but weaker than HttpOnly cookies / SecureStore for production refresh-token storage.

## Notifications

1. Domain actions create notification rows.
2. Relay claims pending rows with `FOR UPDATE SKIP LOCKED`, marks `processing`, attempts email/push, and records success/failure.
3. Preferences suppress configured channels.
4. Invalid Expo tokens are cleaned up.

Gap: templates format money as USD regardless of tenant currency.
