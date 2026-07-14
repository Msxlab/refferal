export interface ConfirmationContent {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
}

export interface AccessChangeInput {
  fullName: string;
  currentTier: string;
  nextTier: string;
  currentRoleName?: string | null;
  nextRoleName?: string | null;
}

const TIER_LABELS: Record<string, string> = {
  tenant_owner: 'Owner',
  tenant_admin: 'Administrator',
  tenant_staff: 'Staff',
  member: 'Member',
};

const TIER_WEIGHT: Record<string, number> = {
  member: 0,
  tenant_staff: 1,
  tenant_admin: 2,
  tenant_owner: 3,
};

function labelForTier(tier: string): string {
  return TIER_LABELS[tier] ?? tier.replace(/_/g, ' ');
}

function tierWeight(tier: string): number {
  return TIER_WEIGHT[tier] ?? 0;
}

/** Human-readable confirmation copy for access changes that take effect on the next request. */
export function accessChangeConfirmation(input: AccessChangeInput): ConfirmationContent {
  const current = labelForTier(input.currentTier);
  const next = labelForTier(input.nextTier);
  const accessIsElevated = tierWeight(input.nextTier) > tierWeight(input.currentTier);
  const accessIsReduced = tierWeight(input.nextTier) < tierWeight(input.currentTier);
  const roleChanged = input.currentRoleName !== input.nextRoleName;

  let message: string;
  if (input.nextTier === 'tenant_admin' && accessIsElevated) {
    message = `${input.fullName} will become an administrator. They can gain access to sensitive business controls; the change takes effect immediately.`;
  } else if (input.nextTier === 'member' && accessIsReduced) {
    message = `${input.fullName} will continue at the member tier. This will remove their administrative access; the change takes effect immediately.`;
  } else if (roleChanged) {
    const fromRole = input.currentRoleName ?? 'no custom role';
    const toRole = input.nextRoleName ?? 'no custom role';
    message = `${input.fullName}'s role will change from ${fromRole} to ${toRole}. Review that role's permissions; the change takes effect immediately.`;
  } else {
    message = `${input.fullName}'s access tier will change from ${current} to ${next}. The change takes effect immediately.`;
  }

  return {
    title: 'Confirm access change',
    message,
    confirmLabel: `Change access to ${next}`,
    danger: accessIsElevated || accessIsReduced || roleChanged,
  };
}

export interface TenantStatusInput {
  companyName: string;
  currentStatus: string;
}

/** Suspension revokes member sessions; reactivation intentionally does not restore them. */
export function tenantStatusConfirmation(input: TenantStatusInput): ConfirmationContent {
  const isSuspending = input.currentStatus === 'active';
  if (isSuspending) {
    return {
      title: 'Suspend company',
      message: `Suspending ${input.companyName} stops tenant sign-ins and revokes active member sessions. Financial records remain intact until you reactivate the company.`,
      confirmLabel: 'Suspend company',
      danger: true,
    };
  }

  return {
    title: 'Reactivate company',
    message: `Reactivating ${input.companyName} allows eligible members to sign in again. It does not restore revoked sessions or change financial records.`,
    confirmLabel: 'Reactivate company',
    danger: false,
  };
}
