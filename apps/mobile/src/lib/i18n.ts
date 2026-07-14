// Mobile copy. The product runtime is English-only by default.
const en = {
  'login.title': 'Member sign-in',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.error': 'Incorrect email or password',
  'common.loading': 'Loading...',
  'common.retry': 'Try again',
  'common.logout': 'Log out',
  'recommendation.heading': 'Next actions',
  'recommendation.sub': 'Recommended steps for this workspace.',
  'recommendation.fallback.title': 'Review your next action',
  'recommendation.fallback.body': 'Open the relevant workspace to review this item.',
  'recommendation.fallback.action': 'Open',
  'recommendation.member.email.unverified.title': 'Email needs attention',
  'recommendation.member.email.unverified.body': 'Review your account access settings.',
  'recommendation.member.email.unverified.action': 'Open account',
  'recommendation.member.payout.processing.title': 'Payout is processing',
  'recommendation.member.payout.processing.body': 'Review your wallet for the latest payout status.',
  'recommendation.member.payout.processing.action': 'Open wallet',
  'recommendation.member.payout.requested.title': 'Payout request is open',
  'recommendation.member.payout.requested.body': 'Review your wallet for the latest request status.',
  'recommendation.member.payout.requested.action': 'Open wallet',
  'recommendation.member.payout.requestable.title': 'Review payout eligibility',
  'recommendation.member.payout.requestable.body': 'Open your wallet to review the next available step.',
  'recommendation.member.payout.requestable.action': 'Open wallet',
  'recommendation.member.invites.expiring.title': 'An invite is expiring soon',
  'recommendation.member.invites.expiring.body': 'Review active invite links before they expire.',
  'recommendation.member.invites.expiring.action': 'Open invites',
  'recommendation.member.mfa.setup.title': 'Strengthen account security',
  'recommendation.member.mfa.setup.body': 'Set up two-factor authentication to protect privileged access.',
  'recommendation.member.mfa.setup.action': 'Open security',
  'recommendation.tenant.sales.draft.title': 'Draft sales need review',
  'recommendation.tenant.sales.draft.body': 'Open sales to review items that are still in draft.',
  'recommendation.tenant.sales.draft.action': 'Open sales',
  'recommendation.tenant.payouts.processing_stale.title': 'Payout batch needs review',
  'recommendation.tenant.payouts.processing_stale.body': 'Open payouts to review the current batch state.',
  'recommendation.tenant.payouts.processing_stale.action': 'Open payouts',
  'recommendation.tenant.payouts.requested.title': 'Payout requests need attention',
  'recommendation.tenant.payouts.requested.body': 'Open payouts to review outstanding requests.',
  'recommendation.tenant.payouts.requested.action': 'Open payouts',
  'recommendation.tenant.sales.delivery_pending.title': 'Delivery updates need review',
  'recommendation.tenant.sales.delivery_pending.body': 'Open sales to review items awaiting delivery updates.',
  'recommendation.tenant.sales.delivery_pending.action': 'Open sales',
  'recommendation.platform.tenants.suspended.title': 'Suspended companies need review',
  'recommendation.platform.tenants.suspended.body': 'Open companies to review suspended workspaces.',
  'recommendation.platform.tenants.suspended.action': 'Open companies',
  'tab.home': 'Overview',
  'tab.wallet': 'Wallet',
  'tab.team': 'Team',
  'tab.invite': 'Invite',
  'home.title': 'Your earnings',
  'home.month': 'Total this month',
  'home.pending': 'Pending',
  'home.payable': 'Payable',
  'home.paid': 'Paid',
  'home.levels': 'Level breakdown',
  'home.level': 'Level',
  'wallet.title': 'Your wallet',
  'wallet.balance': 'Payable balance',
  'wallet.request': 'Request payout',
  'wallet.requested': 'Request received',
  'wallet.ledger': 'Activity',
  'wallet.history': 'Payout requests',
  'team.title': 'My team',
  'team.members': 'People',
  'team.active': 'Active',
  'team.privacy': 'For privacy, only summary data by level is shown.',
  'invite.title': 'Grow your team',
  'invite.create': 'Create invite',
  'invite.share': 'Share link',
  'invite.copied': 'Copied',
  'invite.mine': 'My invites',
  'invite.empty': 'No invites yet',
  'me.noData': 'No data',
  'me.incomeNote':
    'Past earnings are not a guarantee of future income. Commission is earned only from real product sales.',
  'reg.title': 'Invite sign-up',
  'reg.invalid': 'This invite is invalid or has expired',
  'reg.fullName': 'Full name',
  'reg.invitedBy': 'Invited by',
  'reg.tenant': 'Business',
  'reg.submit': 'Create account',
};

export type MsgKey = keyof typeof en;

type RecommendationCopyKeys = { title: MsgKey; body: MsgKey; action: MsgKey };

const recommendationKeys: Record<string, RecommendationCopyKeys> = {
  'member.email.unverified': {
    title: 'recommendation.member.email.unverified.title',
    body: 'recommendation.member.email.unverified.body',
    action: 'recommendation.member.email.unverified.action',
  },
  'member.payout.processing': {
    title: 'recommendation.member.payout.processing.title',
    body: 'recommendation.member.payout.processing.body',
    action: 'recommendation.member.payout.processing.action',
  },
  'member.payout.requested': {
    title: 'recommendation.member.payout.requested.title',
    body: 'recommendation.member.payout.requested.body',
    action: 'recommendation.member.payout.requested.action',
  },
  'member.payout.requestable': {
    title: 'recommendation.member.payout.requestable.title',
    body: 'recommendation.member.payout.requestable.body',
    action: 'recommendation.member.payout.requestable.action',
  },
  'member.invites.expiring': {
    title: 'recommendation.member.invites.expiring.title',
    body: 'recommendation.member.invites.expiring.body',
    action: 'recommendation.member.invites.expiring.action',
  },
  'member.mfa.setup': {
    title: 'recommendation.member.mfa.setup.title',
    body: 'recommendation.member.mfa.setup.body',
    action: 'recommendation.member.mfa.setup.action',
  },
  'tenant.sales.draft': {
    title: 'recommendation.tenant.sales.draft.title',
    body: 'recommendation.tenant.sales.draft.body',
    action: 'recommendation.tenant.sales.draft.action',
  },
  'tenant.payouts.processing_stale': {
    title: 'recommendation.tenant.payouts.processing_stale.title',
    body: 'recommendation.tenant.payouts.processing_stale.body',
    action: 'recommendation.tenant.payouts.processing_stale.action',
  },
  'tenant.payouts.requested': {
    title: 'recommendation.tenant.payouts.requested.title',
    body: 'recommendation.tenant.payouts.requested.body',
    action: 'recommendation.tenant.payouts.requested.action',
  },
  'tenant.sales.delivery_pending': {
    title: 'recommendation.tenant.sales.delivery_pending.title',
    body: 'recommendation.tenant.sales.delivery_pending.body',
    action: 'recommendation.tenant.sales.delivery_pending.action',
  },
  'platform.tenants.suspended': {
    title: 'recommendation.platform.tenants.suspended.title',
    body: 'recommendation.platform.tenants.suspended.body',
    action: 'recommendation.platform.tenants.suspended.action',
  },
};

const fallbackRecommendationKeys: RecommendationCopyKeys = {
  title: 'recommendation.fallback.title',
  body: 'recommendation.fallback.body',
  action: 'recommendation.fallback.action',
};

export function t(key: MsgKey): string {
  return en[key] ?? key;
}

/** Recommendation copy is selected by the canonical policy key; arbitrary server params are intentionally ignored. */
export function recommendationCopy(key: string): { title: string; body: string; action: string } {
  const copy = recommendationKeys[key] ?? fallbackRecommendationKeys;
  return { title: t(copy.title), body: t(copy.body), action: t(copy.action) };
}
