// Runtime copy is English-only. The setter keeps older localStorage values from re-enabling legacy locales.
const en = {
  'app.title': 'Americana Earn',
  'nav.dashboard': 'Overview',
  'nav.sales': 'Sales',
  'nav.members': 'Members',
  'nav.tree': 'Network',
  'nav.payouts': 'Payouts',
  'nav.audit': 'Audit',
  'nav.settings': 'Settings',
  'nav.logout': 'Log out',
  'login.title': 'Business sign-in',
  'login.welcome': 'Welcome back',
  'login.tagline': 'Grow your referral network, distribute commissions automatically.',
  'login.email': 'Email',
  'login.password': 'Password',
  'login.submit': 'Sign in',
  'login.error': 'Incorrect email or password',
  'common.loading': 'Loading...',
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.create': 'Create',
  'common.refresh': 'Refresh',
  'common.actions': 'Actions',
  'common.total': 'Total',
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
  'dash.title': 'Overview',
  'dash.sub': 'Revenue, commission and members for this period.',
  'dash.revenue': 'Revenue this month',
  'dash.commission': 'Commission this month',
  'dash.members': 'Members',
  'dash.payable': 'Payable balance',
  'dash.effRate': 'Effective rate',
  'dash.pendingReq': 'Pending requests',
  'dash.approvedSales': 'Approved sales',
  'dash.commissionShare': 'Commission share',
  'dash.payableHint': 'Total awaiting payout',
  'dash.membersHint': 'Active / total',
  'dash.requestsHint': 'Member payout requests',
  'sales.new': 'New sale',
  'sales.seller': 'Seller (referral code)',
  'sales.amount': 'Amount',
  'sales.status': 'Status',
  'sales.approve': 'Approve',
  'sales.void': 'Void',
  'sales.deliver': 'Deliver',
  'sales.import': 'Import CSV',
  'members.invite': 'Invite',
  'members.deactivate': 'Deactivate',
  'members.activate': 'Activate',
  'members.role': 'Role',
  'payouts.payable': 'Payable',
  'payouts.run': 'Run payouts',
  'payouts.export': 'Export CSV',
  'payouts.history': 'Payout history',
  'anav.home': 'Overview',
  'anav.wallet': 'Wallet',
  'anav.team': 'Network',
  'anav.invite': 'Invite',
  'me.title': 'Your earnings',
  'me.sub': "How this month's commissions from your network are doing.",
  'me.monthTotal': 'Total this month',
  'me.pending': 'Pending',
  'me.payable': 'Payable',
  'me.paid': 'Paid',
  'me.levelBreakdown': 'Level breakdown',
  'me.levelHint': 'How much you earned at each level',
  'me.level': 'Level',
  'me.balance': 'Balance',
  'me.ledger': 'Activity',
  'me.requestPayout': 'Request payout',
  'me.payoutHistory': 'My payout requests',
  'me.teamTitle': 'My team',
  'me.members': 'People',
  'me.activeMembers': 'Active',
  'me.inviteCreate': 'Create invite',
  'me.inviteLink': 'Invite link',
  'me.copy': 'Copy',
  'me.copied': 'Copied',
  'me.myInvites': 'My invites',
  'me.noData': 'No data',
  'me.incomeNote':
    'Past earnings are not a guarantee of future income. Commission is earned only from real product sales.',
  'reg.title': 'Invite sign-up',
  'reg.invalid': 'This invite is invalid or has expired',
  'reg.fullName': 'Full name',
  'reg.submit': 'Create account',
  'reg.invitedBy': 'Invited by',
  'reg.tenant': 'Business',
};

const dicts = { en } as const;
export type Locale = keyof typeof dicts;
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

const DEFAULT_LOCALE: Locale = 'en';

export function getLocale(): Locale {
  return DEFAULT_LOCALE;
}

export function setLocale(_locale: Locale): void {
  window.localStorage.setItem('refearn.locale', DEFAULT_LOCALE);
}

export function t(key: MsgKey): string {
  return dicts[getLocale()][key] ?? en[key] ?? key;
}

/** Recommendation copy is selected by the canonical policy key; arbitrary server params are intentionally ignored. */
export function recommendationCopy(key: string): { title: string; body: string; action: string } {
  const copy = recommendationKeys[key] ?? fallbackRecommendationKeys;
  return { title: t(copy.title), body: t(copy.body), action: t(copy.action) };
}
