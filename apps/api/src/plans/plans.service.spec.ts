import { ConflictException } from '@nestjs/common';
import { PlansService } from './plans.service';

describe('PlansService version creation', () => {
  const actor = {
    tenantId: '10000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
  };
  const input = {
    name: 'Growth',
    poolRateBps: 2000,
    depth: 2,
    levels: [
      { level: 0, rateBps: 1000 },
      { level: 1, rateBps: 500 },
    ],
  };

  it('takes the tenant advisory lock before allocating the next monotonic version', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async () => {
        calls.push('lock');
        return 1;
      }),
      commissionPlan: {
        aggregate: jest.fn(async () => {
          calls.push('aggregate');
          return { _max: { version: 7 } };
        }),
        findFirst: jest.fn(async () => {
          calls.push('effective-check');
          return null;
        }),
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          calls.push('create');
          return {
            id: '30000000-0000-0000-0000-000000000001',
            version: args.data.version,
            effectiveFrom: args.data.effectiveFrom,
            name: args.data.name,
            poolRateBps: args.data.poolRateBps,
            depth: args.data.depth,
            fastStartBps: args.data.fastStartBps,
            fastStartDays: args.data.fastStartDays,
            matchingBps: args.data.matchingBps,
            levels: input.levels,
          };
        }),
        update: jest.fn(async () => {
          calls.push('finalize');
          return {};
        }),
      },
      auditLog: {
        create: jest.fn(async () => {
          calls.push('audit');
          return {};
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new PlansService(prisma as never);

    const result = (await service.createVersion(actor, input)) as unknown as {
      version: number;
      effectiveFrom: Date;
    };

    expect(calls).toEqual(['lock', 'aggregate', 'effective-check', 'create', 'finalize', 'audit']);
    expect(tx.commissionPlan.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tenantId: actor.tenantId, version: 8, finalized: false }),
      }),
    );
    expect(tx.commissionPlan.update).toHaveBeenCalledWith({
      where: { id: '30000000-0000-0000-0000-000000000001' },
      data: { finalized: true },
    });
    expect(result.version).toBe(8);
    expect(result.effectiveFrom).toBeInstanceOf(Date);
  });

  it('maps a duplicate tenant/effective date to a stable conflict response', async () => {
    const duplicate = Object.assign(new Error('duplicate'), {
      code: 'P2002',
      meta: { target: ['tenant_id', 'effective_from'] },
    });
    const tx = {
      $executeRaw: jest.fn(async () => 1),
      commissionPlan: {
        aggregate: jest.fn(async () => ({ _max: { version: 1 } })),
        create: jest.fn(async () => {
          throw duplicate;
        }),
        update: jest.fn(),
      },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    const service = new PlansService(prisma as never);

    await expect(
      service.createVersion(actor, { ...input, effectiveFrom: '2026-08-01T00:00:00.000Z' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
