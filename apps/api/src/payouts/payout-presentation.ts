export type PayoutState = 'requested' | 'processing' | 'settled' | 'rejected' | 'failed';
export type PayoutMethodPresentation = 'ach' | 'check';
export type HoldOwner = 'workspace-admin' | 'earnica-support' | 'external-provider' | 'system-policy';
export type PayoutActionCandidate = 'approve-request' | 'reject-request' | 'dispatch-batch' | 'settle-batch' | 'fail-batch';

export interface PayoutActionCandidatePrincipal {
  mid: string | null;
  tid: string | null;
  role: string | null;
  perms?: string[];
}

export interface PayoutPresentation {
  state: PayoutState | 'status-unavailable';
  baseState: PayoutState | null;
  phase: 'eligibility' | 'review' | 'fulfillment' | 'unavailable';
  terminal: boolean;
  authority: 'legacy-snapshot' | 'event-log' | 'unavailable';
  method: PayoutMethodPresentation | null;
  attemptId: string | null;
  amount: { amountCents: string; currency: string };
  period: string;
  timestamps: { createdAt: string; processingAt: string | null; terminalAt: string | null };
  hold: { reasonCode: string; owner: HoldOwner } | null;
  safeReason: { code: string; message: string } | null;
  actions: { mutations: 'not-evaluated' | 'disabled'; support: { kind: 'support'; reasonCode: string } | null };
  actionCandidates: { authority: 'active-tenant' | 'unavailable'; mutations: PayoutActionCandidate[] };
}

export interface LegacyPayoutSnapshot {
  status: unknown; batchId?: unknown; totalCents?: unknown; currency?: unknown; period?: unknown; createdAt?: unknown;
  processingStartedAt?: unknown; paidAt?: unknown; settledAt?: unknown; rejectedAt?: unknown; failedAt?: unknown;
  settlementReference?: unknown; settlementEvidence?: unknown; rejectionReason?: unknown; failureReason?: unknown;
}

export interface SyntheticPayoutEvent {
  id: string; authoritativeVersion: number; type: 'requested' | 'processing' | 'settled' | 'rejected' | 'failed' | 'hold' | 'reversed'; occurredAt: string;
  attemptId?: string | null; method?: PayoutMethodPresentation | null; reasonCode?: string; owner?: HoldOwner; auditReference?: string;
}
export interface SyntheticPayoutSeed { amountCents: string; currency: string; period: string; createdAt: string }

const terminal = new Set<PayoutState>(['settled', 'rejected', 'failed']);
const owners = new Set<HoldOwner>(['workspace-admin', 'earnica-support', 'external-provider', 'system-policy']);
const empty = (value: unknown) => value === null || value === undefined;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const date = (value: unknown): Date | null => {
  if (value instanceof Date) return !Number.isNaN(value.getTime()) ? new Date(value.getTime()) : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const candidate = new Date(value);
  return !Number.isNaN(candidate.getTime()) && candidate.toISOString() === value ? candidate : null;
};
const iso = (value: Date | null) => value?.toISOString() ?? null;
const allEmpty = (...values: unknown[]) => values.every(empty);
const ordered = (...values: Array<Date | null>) => values.every((item) => item) && values.every((item, index) => index === 0 || item!.getTime() >= values[index - 1]!.getTime());
const validCents = (value: unknown) => typeof value === 'bigint' || typeof value === 'string' && /^-?\d+$/.test(value);
const validCurrency = (value: unknown) => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const validPeriod = (value: unknown) => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
const hasFinancialContext = (input: LegacyPayoutSnapshot | SyntheticPayoutSeed) => validCents('amountCents' in input ? input.amountCents : input.totalCents) && validCurrency(input.currency) && validPeriod(input.period);

function amount(input: LegacyPayoutSnapshot | SyntheticPayoutSeed) {
  const cents = 'amountCents' in input ? input.amountCents : input.totalCents;
  return {
    amountCents: typeof cents === 'bigint' ? cents.toString() : typeof cents === 'string' && /^-?\d+$/.test(cents) ? cents : '0',
    currency: typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency) ? input.currency : 'USD',
  };
}
function unavailable(input: LegacyPayoutSnapshot | SyntheticPayoutSeed): PayoutPresentation {
  const financialContext = hasFinancialContext(input);
  return { state: 'status-unavailable', baseState: null, phase: 'unavailable', terminal: false, authority: 'unavailable', method: null, attemptId: null,
    amount: financialContext ? amount(input) : { amountCents: '', currency: '' }, period: financialContext && typeof input.period === 'string' ? input.period : '', timestamps: { createdAt: iso(date(input.createdAt)) ?? '', processingAt: null, terminalAt: null }, hold: null,
    safeReason: { code: 'payout_status_unavailable', message: 'Payout status is unavailable.' }, actions: { mutations: 'disabled', support: { kind: 'support', reasonCode: 'payout_status_unavailable' } }, actionCandidates: { authority: 'unavailable', mutations: [] } };
}
function presentation(authority: 'legacy-snapshot' | 'event-log', input: LegacyPayoutSnapshot | SyntheticPayoutSeed, state: PayoutState, timestamps: PayoutPresentation['timestamps'], method: PayoutMethodPresentation | null = null, attemptId: string | null = null, hold: PayoutPresentation['hold'] = null): PayoutPresentation {
  const safeReason = state === 'rejected' ? { code: 'payout_rejected', message: 'The payout request was rejected.' } : state === 'failed' ? { code: 'payout_failed', message: 'The payout could not be completed.' } : null;
  return { state, baseState: state, phase: state === 'requested' ? 'eligibility' : state === 'rejected' ? 'review' : 'fulfillment', terminal: terminal.has(state), authority, method, attemptId,
    amount: amount(input), period: typeof input.period === 'string' ? input.period : '', timestamps, hold, safeReason,
    actions: { mutations: 'not-evaluated', support: safeReason ? { kind: 'support', reasonCode: safeReason.code } : null }, actionCandidates: { authority: 'unavailable', mutations: [] } };
}

function activeTenantCandidates(
  presentation: PayoutPresentation,
  principal: PayoutActionCandidatePrincipal,
  memberResponse: boolean,
  batchStatus?: string | null,
): PayoutPresentation['actionCandidates'] {
  if (
    typeof principal.mid !== 'string' ||
    typeof principal.tid !== 'string' ||
    typeof principal.role !== 'string' ||
    !Array.isArray(principal.perms) ||
    !principal.perms.every((permission) => typeof permission === 'string')
  ) {
    return { authority: 'unavailable', mutations: [] };
  }
  if (
    memberResponse ||
    presentation.state === 'status-unavailable' ||
    presentation.terminal ||
    (principal.role !== 'tenant_owner' && principal.role !== 'tenant_admin') ||
    !principal.perms.includes('payouts.process')
  ) {
    return { authority: 'active-tenant', mutations: [] };
  }
  if (presentation.state === 'requested') {
    return { authority: 'active-tenant', mutations: ['approve-request', 'reject-request'] };
  }
  if (presentation.state === 'processing') {
    // The default retains a safe action model for old snapshot-only callers;
    // live admin responses always provide the actual settlement-batch status.
    if ((batchStatus ?? 'processing') === 'dispatched') {
      return { authority: 'active-tenant', mutations: ['settle-batch'] };
    }
    if ((batchStatus ?? 'processing') === 'processing') {
      return { authority: 'active-tenant', mutations: ['dispatch-batch', 'fail-batch'] };
    }
    return { authority: 'active-tenant', mutations: [] };
  }
  return { authority: 'active-tenant', mutations: [] };
}

/** Advisory read model only; existing route guards and mutation services remain authoritative. */
export function withPayoutActionCandidates(
  presentation: PayoutPresentation,
  principal: PayoutActionCandidatePrincipal,
  memberResponse = false,
  batchStatus?: string | null,
): PayoutPresentation {
  return { ...presentation, actionCandidates: activeTenantCandidates(presentation, principal, memberResponse, batchStatus) };
}

/** Maps only persisted legacy snapshot evidence; it intentionally never infers a payment rail. */
export function mapLegacyPayoutPresentation(input: LegacyPayoutSnapshot): PayoutPresentation {
  const created = date(input.createdAt), processing = date(input.processingStartedAt), paid = date(input.paidAt), settled = date(input.settledAt), rejected = date(input.rejectedAt), failed = date(input.failedAt);
  const relevant = [[input.createdAt, created], [input.processingStartedAt, processing], [input.paidAt, paid], [input.settledAt, settled], [input.rejectedAt, rejected], [input.failedAt, failed]];
  if (!hasFinancialContext(input) || !created || relevant.some(([raw, parsed]) => !empty(raw) && !parsed)) return unavailable(input);
  const timestamps = { createdAt: created.toISOString(), processingAt: iso(processing), terminalAt: null };
  if (input.status === 'requested' && allEmpty(input.batchId, input.processingStartedAt, input.paidAt, input.settledAt, input.rejectedAt, input.failedAt, input.settlementReference, input.settlementEvidence, input.rejectionReason, input.failureReason)) return presentation('legacy-snapshot', input, 'requested', timestamps);
  if (input.status === 'processing' && text(input.batchId) && processing && ordered(created, processing) && allEmpty(input.paidAt, input.settledAt, input.rejectedAt, input.failedAt, input.settlementReference, input.settlementEvidence, input.rejectionReason, input.failureReason)) return presentation('legacy-snapshot', input, 'processing', timestamps);
  if (input.status === 'paid' && processing && paid && settled && text(input.settlementReference) && text(input.settlementEvidence) && ordered(created, processing, paid, settled) && allEmpty(input.rejectedAt, input.failedAt, input.rejectionReason, input.failureReason)) return presentation('legacy-snapshot', input, 'settled', { ...timestamps, terminalAt: settled.toISOString() });
  if (input.status === 'rejected' && rejected && text(input.rejectionReason) && ordered(created, rejected) && allEmpty(input.batchId, input.processingStartedAt, input.paidAt, input.settledAt, input.failedAt, input.settlementReference, input.settlementEvidence, input.failureReason)) return presentation('legacy-snapshot', input, 'rejected', { ...timestamps, terminalAt: rejected.toISOString() });
  if (input.status === 'failed' && text(input.batchId) && processing && failed && text(input.failureReason) && ordered(created, processing, failed) && allEmpty(input.paidAt, input.settledAt, input.rejectedAt, input.settlementReference, input.settlementEvidence, input.rejectionReason)) return presentation('legacy-snapshot', input, 'failed', { ...timestamps, terminalAt: failed.toISOString() });
  return unavailable(input);
}

const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value);

/** Future-only deterministic fold. Production does not call this until authoritative event storage exists. */
export function foldSyntheticPayoutEvents(events: readonly SyntheticPayoutEvent[], seed: SyntheticPayoutSeed): PayoutPresentation {
  const created = date(seed.createdAt);
  if (!created || !hasFinancialContext(seed)) return unavailable(seed);
  const ids = new Map<string, SyntheticPayoutEvent>();
  for (const event of events) {
    if (!event || !text(event.id) || !Number.isInteger(event.authoritativeVersion) || event.authoritativeVersion < 1 || !date(event.occurredAt)) return unavailable(seed);
    const prior = ids.get(event.id); if (prior && stable(prior) !== stable(event)) return unavailable(seed); ids.set(event.id, event);
  }
  const sorted = [...ids.values()].sort((a, b) => a.authoritativeVersion - b.authoritativeVersion || a.id.localeCompare(b.id));
  if (!sorted.length || sorted.some((event, index) => event.authoritativeVersion !== index + 1)) return unavailable(seed);
  let state: PayoutState | null = null, processing: Date | null = null, terminalAt: Date | null = null, attemptId: string | null = null, method: PayoutMethodPresentation | null = null, hold: PayoutPresentation['hold'] = null, previous = created;
  for (const event of sorted) {
    const occurred = date(event.occurredAt)!; if (occurred < previous) return unavailable(seed); previous = occurred;
    if (event.type === 'hold') { if (!state || terminal.has(state) || !text(event.reasonCode) || !event.owner || !owners.has(event.owner) || !empty(event.attemptId) || !empty(event.method)) return unavailable(seed); hold = { reasonCode: event.reasonCode, owner: event.owner }; continue; }
    hold = null;
    if (event.type === 'requested') { if (state || !empty(event.attemptId) || !empty(event.method)) return unavailable(seed); state = 'requested'; continue; }
    if (event.type === 'processing') { if (state !== 'requested' || !text(event.attemptId) || (event.method !== 'ach' && event.method !== 'check')) return unavailable(seed); state = 'processing'; attemptId = event.attemptId; method = event.method; processing = occurred; continue; }
    if (event.type === 'rejected') { if (state !== 'requested' || !empty(event.attemptId) || !empty(event.method)) return unavailable(seed); state = 'rejected'; terminalAt = occurred; continue; }
    if (event.type === 'settled' || event.type === 'failed') { if (state !== 'processing' || event.attemptId !== attemptId || event.method !== method) return unavailable(seed); state = event.type === 'settled' ? 'settled' : 'failed'; terminalAt = occurred; continue; }
    if (event.type === 'reversed') return unavailable(seed);
    return unavailable(seed);
  }
  return state ? presentation('event-log', seed, state, { createdAt: created.toISOString(), processingAt: iso(processing), terminalAt: iso(terminalAt) }, method, attemptId, hold) : unavailable(seed);
}
