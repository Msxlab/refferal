import { InviteStatus, MembershipStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { INVITE_DISCLAIMER_REGISTRY, INVITE_DISCLAIMER_VERSION } from './invite-consent';
import { InvitesService } from './invites.service';

describe('InvitesService public resolve contract', () => {
  it('selects and returns only the public signup state', async () => {
    const expiresAt = new Date('2026-08-01T12:00:00.000Z');
    const findUnique = jest.fn().mockResolvedValue({
      status: InviteStatus.active,
      tenantId: 'tenant-1',
      expiresAt,
      email: null,
      tenant: {
        name: 'Privacy First Co',
        status: TenantStatus.active,
      },
      inviter: {
        status: MembershipStatus.active,
      },
    });
    const findFirst = jest.fn().mockResolvedValue({
      name: 'Growth Plan',
      poolRateBps: 1_250,
      depth: 4,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    });
    const service = new InvitesService({
      invite: { findUnique },
      commissionPlan: { findFirst },
    } as unknown as PrismaService);

    const result = await service.resolve('PUBLIC1234');

    expect(findUnique).toHaveBeenCalledWith({
      where: { code: 'PUBLIC1234' },
      select: {
        status: true,
        tenantId: true,
        expiresAt: true,
        email: true,
        tenant: { select: { name: true, status: true } },
        inviter: { select: { status: true } },
      },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId: 'tenant-1', effectiveFrom: { lte: expect.any(Date) } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { name: true, poolRateBps: true, depth: true, effectiveFrom: true },
    });
    expect(result).toEqual({
      state: 'valid',
      tenant: { displayName: 'Privacy First Co' },
      programSummary: expect.stringContaining('Growth Plan'),
      disclaimer: {
        version: INVITE_DISCLAIMER_VERSION,
        locale: 'en',
        body: INVITE_DISCLAIMER_REGISTRY[INVITE_DISCLAIMER_VERSION].en,
      },
      expiresAt: expiresAt.toISOString(),
    });
  });
});
