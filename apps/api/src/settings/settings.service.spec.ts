import { MaturationRule } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from './settings.service';

interface TenantState {
  id: string;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
  maturationRule: MaturationRule;
  maturationDays: number | null;
  payoutMinCents: bigint;
  notifyNewMemberName: boolean;
  compressionEnabled: boolean;
  inactiveMembersEarn: boolean;
  requireSeparateApprover: boolean;
  requireKycForPayout: boolean;
  requirePayoutApproval: boolean;
  autoRequestPayouts: boolean;
  branding: Record<string, string>;
}

interface AuditEvent {
  tenantId: string;
  actorUserId: string;
  action: string;
  entity: string;
  entityId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

interface TransactionDouble {
  tenant: {
    findUniqueOrThrow(args: unknown): Promise<TenantState>;
    update(args: { data: Record<string, unknown> }): Promise<TenantState>;
  };
  auditLog: {
    create(args: { data: AuditEvent }): Promise<AuditEvent>;
  };
}

const actor: ActorContext = {
  userId: '20000000-0000-0000-0000-000000000001',
  tenantId: '10000000-0000-0000-0000-000000000001',
};

const initialTenant: TenantState = {
  id: actor.tenantId,
  slug: 'network-ledger',
  name: 'Network Ledger',
  currency: 'USD',
  timezone: 'America/New_York',
  maturationRule: MaturationRule.on_approval,
  maturationDays: null,
  payoutMinCents: 1_000n,
  notifyNewMemberName: true,
  compressionEnabled: false,
  inactiveMembersEarn: true,
  requireSeparateApprover: false,
  requireKycForPayout: false,
  requirePayoutApproval: false,
  autoRequestPayouts: true,
  branding: {
    logoText: 'NL',
    tagline: 'Before',
    primaryColor: '#111111',
    accentColor: '#222222',
  },
};

function cloneTenant(tenant: TenantState): TenantState {
  return { ...tenant, branding: { ...tenant.branding } };
}

function applyTenantUpdate(tenant: TenantState, data: Record<string, unknown>): TenantState {
  const patch = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  Object.assign(tenant, patch);
  return cloneTenant(tenant);
}

function createPrismaHarness(options: { failAudit?: boolean } = {}) {
  let committed = cloneTenant(initialTenant);
  const auditEvents: AuditEvent[] = [];

  const transactionFor = (tenant: TenantState, stagedAudits: AuditEvent[]): TransactionDouble => ({
    tenant: {
      findUniqueOrThrow: async () => cloneTenant(tenant),
      update: async ({ data }) => applyTenantUpdate(tenant, data),
    },
    auditLog: {
      create: async ({ data }) => {
        if (options.failAudit) throw new Error('audit persistence failed');
        stagedAudits.push(data);
        return data;
      },
    },
  });

  const prismaDouble = {
    tenant: {
      findUniqueOrThrow: async () => cloneTenant(committed),
      update: async ({ data }: { data: Record<string, unknown> }) => applyTenantUpdate(committed, data),
    },
    auditLog: {
      create: async ({ data }: { data: AuditEvent }) => {
        if (options.failAudit) throw new Error('audit persistence failed');
        auditEvents.push(data);
        return data;
      },
    },
    async $transaction<T>(callback: (tx: TransactionDouble) => Promise<T>): Promise<T> {
      const working = cloneTenant(committed);
      const stagedAudits: AuditEvent[] = [];
      const result = await callback(transactionFor(working, stagedAudits));
      committed = working;
      auditEvents.push(...stagedAudits);
      return result;
    },
  };

  return {
    prisma: prismaDouble as unknown as PrismaService,
    auditEvents,
    state: () => cloneTenant(committed),
  };
}

function createService(harness: ReturnType<typeof createPrismaHarness>): SettingsService {
  return new SettingsService(harness.prisma, {} as PlansService);
}

describe('SettingsService.update', () => {
  it('records every mutable setting in symmetric before and after snapshots', async () => {
    const harness = createPrismaHarness();

    await createService(harness).update(actor, {
      name: 'Network Ledger Plus',
      maturationRule: MaturationRule.days_after_approval,
      maturationDays: 14,
      payoutMinCents: 2_500n,
      timezone: 'Europe/Istanbul',
      notifyNewMemberName: false,
      compressionEnabled: true,
      inactiveMembersEarn: false,
      requireSeparateApprover: true,
      requireKycForPayout: true,
      requirePayoutApproval: true,
      autoRequestPayouts: false,
      branding: { logoText: 'Ledger', primaryColor: '#ABCDEF' },
    });

    expect(harness.auditEvents).toHaveLength(1);
    expect(harness.auditEvents[0].before).toEqual({
      name: 'Network Ledger',
      maturationRule: MaturationRule.on_approval,
      maturationDays: null,
      payoutMinCents: '1000',
      timezone: 'America/New_York',
      notifyNewMemberName: true,
      compressionEnabled: false,
      inactiveMembersEarn: true,
      requireSeparateApprover: false,
      requireKycForPayout: false,
      requirePayoutApproval: false,
      autoRequestPayouts: true,
      branding: initialTenant.branding,
    });
    expect(harness.auditEvents[0].after).toEqual({
      name: 'Network Ledger Plus',
      maturationRule: MaturationRule.days_after_approval,
      maturationDays: 14,
      payoutMinCents: '2500',
      timezone: 'Europe/Istanbul',
      notifyNewMemberName: false,
      compressionEnabled: true,
      inactiveMembersEarn: false,
      requireSeparateApprover: true,
      requireKycForPayout: true,
      requirePayoutApproval: true,
      autoRequestPayouts: false,
      branding: {
        logoText: 'LE',
        tagline: 'Before',
        primaryColor: '#ABCDEF',
        accentColor: '#222222',
      },
    });
  });

  it('rolls back the tenant mutation when audit persistence fails', async () => {
    const harness = createPrismaHarness({ failAudit: true });

    await expect(
      createService(harness).update(actor, {
        payoutMinCents: 9_999n,
        requireKycForPayout: true,
        autoRequestPayouts: false,
      }),
    ).rejects.toThrow('audit persistence failed');

    expect(harness.state()).toEqual(initialTenant);
    expect(harness.auditEvents).toHaveLength(0);
  });
});

describe('SettingsService plan bonus delegation', () => {
  const bonus = { fastStartBps: 700, fastStartDays: 30, matchingBps: 250 };

  function serviceWith(plans: {
    getPlanBonus: jest.Mock;
    createBonusVersion: jest.Mock;
  }): SettingsService {
    const Constructor = SettingsService as unknown as new (prisma: unknown, plans: unknown) => SettingsService;
    return new Constructor({}, plans);
  }

  it('delegates reads to the plan version owner', async () => {
    const expected = { planId: 'plan-1', planName: 'Current', ...bonus };
    const plans = {
      getPlanBonus: jest.fn(async () => expected),
      createBonusVersion: jest.fn(),
    };

    await expect(serviceWith(plans).getPlanBonus(actor.tenantId)).resolves.toEqual(expected);
    expect(plans.getPlanBonus).toHaveBeenCalledWith(actor.tenantId);
  });

  it('delegates bonus changes to immutable version creation', async () => {
    const expected = { planId: 'plan-2', planName: 'Current', version: 2, ...bonus };
    const plans = {
      getPlanBonus: jest.fn(),
      createBonusVersion: jest.fn(async () => expected),
    };

    await expect(serviceWith(plans).updatePlanBonus(actor, bonus)).resolves.toEqual(expected);
    expect(plans.createBonusVersion).toHaveBeenCalledWith(actor, bonus);
  });
});
