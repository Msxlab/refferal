import { InviteStatus, MembershipStatus, TenantStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InvitesService } from './invites.service';

describe('InvitesService public resolve contract', () => {
  it('selects and returns only fields required by the public signup page', async () => {
    const expiresAt = new Date('2026-08-01T12:00:00.000Z');
    const findUnique = jest.fn().mockResolvedValue({
      code: 'PUBLIC1234',
      status: InviteStatus.active,
      expiresAt,
      email: null,
      tenant: {
        name: 'Privacy First Co',
        slug: 'privacy-first',
        status: TenantStatus.active,
      },
      inviter: {
        status: MembershipStatus.active,
        inviteMessage: 'Private welcome note',
        user: { fullName: 'Private Person' },
      },
    });
    const service = new InvitesService({ invite: { findUnique } } as unknown as PrismaService);

    const result = await service.resolve('PUBLIC1234');

    expect(findUnique).toHaveBeenCalledWith({
      where: { code: 'PUBLIC1234' },
      select: {
        code: true,
        status: true,
        expiresAt: true,
        email: true,
        tenant: { select: { name: true, slug: true, status: true } },
        inviter: { select: { status: true } },
      },
    });
    expect(result).toEqual({
      code: 'PUBLIC1234',
      valid: true,
      tenantName: 'Privacy First Co',
      tenantSlug: 'privacy-first',
      expiresAt,
      emailLocked: false,
    });
  });
});
