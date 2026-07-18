export type ReadinessCheckKey =
  | 'email'
  | 'payable_balance'
  | 'threshold'
  | 'open_request'
  | 'address'
  | 'kyc'
  | 'fraud'
  | 'sanctions'
  | 'payment_method'
  | 'mfa';

export type RemediationTarget =
  | { kind: 'native'; route: string }
  | { kind: 'verified-web'; url: string; returnTo?: string }
  | { kind: 'external-provider'; sessionUrl: string; expiresAt: string }
  | { kind: 'support'; reasonCode: string };

export type ReadinessCheck = {
  key: ReadinessCheckKey;
  status: 'ready' | 'blocked' | 'unknown';
  reasonCode: string;
  owner: 'member' | 'workspace-admin' | 'earnica-support' | 'external-provider' | 'system-policy';
  remediation: RemediationTarget | null;
  recheck: { mode: 'after-action' | 'at' | 'manual'; at?: string };
  authority: 'user' | 'ledger' | 'payout' | 'auth' | 'compliance' | 'unavailable';
};

export type PayoutReadiness = {
  requestable: boolean;
  checks: ReadinessCheck[];
  threshold: { amountCents: string; currency: string };
};

export type PayoutReadinessMfaInput =
  | { requirement: 'unknown' }
  | { requirement: 'not-required' }
  | { requirement: 'required'; assurance: 'current' | 'missing' | 'expired' | 'unknown' };

export type PayoutReadinessActivePayout = {
  id: string;
  status: 'requested' | 'processing';
};

export type ManualPayoutReadinessDecision = {
  key: Extract<ReadinessCheckKey, 'address' | 'kyc' | 'fraud' | 'sanctions' | 'payment_method'>;
  status: 'pending' | 'ready' | 'blocked';
  reasonCode: string;
  expiresAt: Date | null;
  version: number;
};

export type ActivePayoutDestination = {
  verifiedAt: Date | null;
  version: number;
} | null;

export type PayoutReadinessInput = {
  emailVerified: boolean;
  payableCents: bigint;
  threshold: { amountCents: bigint; currency: string };
  activePayout: PayoutReadinessActivePayout | null;
  mfa: PayoutReadinessMfaInput;
  manualChecks?: readonly ManualPayoutReadinessDecision[];
  destination?: ActivePayoutDestination;
};

export type LegacyPayoutEligibilityReason =
  | 'eligible'
  | 'no_payable'
  | 'below_threshold'
  | 'email_unverified'
  | 'requested'
  | 'processing'
  | 'readiness_unavailable';

const manualRecheck = () => ({ mode: 'manual' as const });
const afterActionRecheck = () => ({ mode: 'after-action' as const });

type ManualReadinessCheckKey = ManualPayoutReadinessDecision['key'];

export function isValidPayoutReadinessVersion(version: number): boolean {
  return Number.isSafeInteger(version) && version > 0;
}

function manualCheck(
  key: ManualReadinessCheckKey,
  input: Pick<PayoutReadinessInput, 'manualChecks' | 'destination'>,
  evaluatedAt: number,
): ReadinessCheck {
  const result = (status: 'ready' | 'blocked', reasonCode: string): ReadinessCheck => ({
    key,
    status,
    reasonCode,
    owner: 'workspace-admin',
    remediation: null,
    recheck: manualRecheck(),
    authority: 'compliance',
  });
  const decisions = input.manualChecks?.filter((candidate) => candidate.key === key) ?? [];

  if (decisions.length === 0) return result('blocked', 'review_required');
  if (decisions.length > 1) return result('blocked', 'review_conflict');
  const [decision] = decisions;
  if (!isValidPayoutReadinessVersion(decision.version)) return result('blocked', 'review_invalid');
  if (decision.status === 'pending') return result('blocked', 'review_pending');
  if (decision.status === 'blocked') {
    return result('blocked', decision.reasonCode.trim() ? decision.reasonCode : 'review_blocked');
  }
  if (decision.expiresAt && decision.expiresAt.getTime() <= evaluatedAt) {
    return result('blocked', 'review_expired');
  }
  if (
    key === 'payment_method' &&
    (!input.destination?.verifiedAt || !isValidPayoutReadinessVersion(input.destination.version))
  ) {
    return result('blocked', 'payment_destination_required');
  }
  return result('ready', decision.reasonCode.trim() ? decision.reasonCode : 'review_approved');
}

function evaluateMfa(input: PayoutReadinessMfaInput): ReadinessCheck {
  if (input.requirement === 'unknown') {
    return {
      key: 'mfa',
      status: 'unknown',
      reasonCode: 'requirement_unknown',
      owner: 'system-policy',
      remediation: null,
      recheck: manualRecheck(),
      authority: 'auth',
    };
  }
  if (input.requirement === 'not-required') {
    return {
      key: 'mfa',
      status: 'ready',
      reasonCode: 'not_required',
      owner: 'system-policy',
      remediation: null,
      recheck: manualRecheck(),
      authority: 'auth',
    };
  }
  if (input.assurance === 'current') {
    return {
      key: 'mfa',
      status: 'ready',
      reasonCode: 'assurance_current',
      owner: 'member',
      remediation: null,
      recheck: afterActionRecheck(),
      authority: 'auth',
    };
  }
  if (input.assurance === 'unknown') {
    return {
      key: 'mfa',
      status: 'unknown',
      reasonCode: 'assurance_unknown',
      owner: 'system-policy',
      remediation: null,
      recheck: manualRecheck(),
      authority: 'auth',
    };
  }
  return {
    key: 'mfa',
    status: 'blocked',
    reasonCode: input.assurance === 'expired' ? 'assurance_expired' : 'assurance_missing',
    owner: 'member',
    remediation: null,
    recheck: afterActionRecheck(),
    authority: 'auth',
  };
}

export function evaluatePayoutReadiness(input: PayoutReadinessInput): PayoutReadiness {
  const evaluatedAt = Date.now();
  const email: ReadinessCheck = {
    key: 'email',
    status: input.emailVerified ? 'ready' : 'blocked',
    reasonCode: input.emailVerified ? 'email_verified' : 'email_unverified',
    owner: 'member',
    remediation: null,
    recheck: afterActionRecheck(),
    authority: 'user',
  };
  const payableBalance: ReadinessCheck = {
    key: 'payable_balance',
    status: input.payableCents > 0n ? 'ready' : 'blocked',
    reasonCode: input.payableCents > 0n ? 'payable_balance_available' : 'no_payable',
    owner: 'member',
    remediation: null,
    recheck: manualRecheck(),
    authority: 'ledger',
  };
  const threshold: ReadinessCheck = {
    key: 'threshold',
    status: input.payableCents >= input.threshold.amountCents ? 'ready' : 'blocked',
    reasonCode: input.payableCents >= input.threshold.amountCents ? 'threshold_met' : 'below_threshold',
    owner: 'system-policy',
    remediation: null,
    recheck: manualRecheck(),
    authority: 'ledger',
  };
  const openRequest: ReadinessCheck = {
    key: 'open_request',
    status: input.activePayout ? 'blocked' : 'ready',
    reasonCode: input.activePayout ? `payout_${input.activePayout.status}` : 'no_open_request',
    owner: 'member',
    remediation: null,
    recheck: manualRecheck(),
    authority: 'payout',
  };
  const mfa = evaluateMfa(input.mfa);
  const checks: ReadinessCheck[] = [
    email,
    payableBalance,
    threshold,
    openRequest,
    manualCheck('address', input, evaluatedAt),
    manualCheck('kyc', input, evaluatedAt),
    manualCheck('fraud', input, evaluatedAt),
    manualCheck('sanctions', input, evaluatedAt),
    manualCheck('payment_method', input, evaluatedAt),
    mfa,
  ];

  const mfaRequirementIsUnknown = input.mfa.requirement === 'unknown';
  const requestable = checks.every(
    (check) => check.status === 'ready' || (check.key === 'mfa' && mfaRequirementIsUnknown && check.status === 'unknown'),
  );

  return {
    requestable,
    checks,
    threshold: { amountCents: input.threshold.amountCents.toString(), currency: input.threshold.currency },
  };
}

export function legacyPayoutEligibilityReason(
  readiness: PayoutReadiness,
  activePayout: PayoutReadinessActivePayout | null,
): LegacyPayoutEligibilityReason {
  if (readiness.checks.find((check) => check.key === 'email')?.status !== 'ready') return 'email_unverified';
  if (activePayout?.status === 'processing') return 'processing';
  if (activePayout?.status === 'requested') return 'requested';
  if (readiness.checks.find((check) => check.key === 'payable_balance')?.status !== 'ready') return 'no_payable';
  if (readiness.checks.find((check) => check.key === 'threshold')?.status !== 'ready') return 'below_threshold';
  return readiness.requestable ? 'eligible' : 'readiness_unavailable';
}
