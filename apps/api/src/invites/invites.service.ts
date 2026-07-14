import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InviteStatus, MembershipStatus, TenantStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { randomCode, sha256 } from '../common/crypto';
import { publicBrandFromTenant } from '../common/branding';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { authConfig } from '../auth/auth.config';

// Invite limits for sybil/spam control, scoped per member.
const MAX_ACTIVE_INVITES = 50;
const MAX_INVITES_PER_DAY = 20;

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext?: TenantContextService,
  ) {}

  /** Every active member can create invites (tree growth by invitation; SPEC 1). */
  async create(inviterMembershipId: string, opts: { email?: string } = {}, idempotencyKey?: string) {
    this.tenantContext?.assertMembership(inviterMembershipId);
    return this.issue(inviterMembershipId, opts, idempotencyKey);
  }

  /** Admin issuance may select another active sponsor in the same tenant. */
  async createForAdmin(
    actor: ActorContext,
    inviterMembershipId: string,
    opts: { email?: string } = {},
    idempotencyKey?: string,
  ) {
    this.tenantContext?.assertActor(actor);
    return this.issue(inviterMembershipId, opts, idempotencyKey, actor.tenantId);
  }

  private async issue(
    inviterMembershipId: string,
    opts: { email?: string } = {},
    idempotencyKey?: string,
    expectedTenantId?: string,
  ) {
    const email = opts.email?.trim().toLowerCase() || undefined;
    const keyHash = idempotencyKey ? sha256(`invite-idempotency:v1:${idempotencyKey.trim()}`) : undefined;
    return this.prisma.$transaction(async (tx) => {
      // All invitation issuance paths lock this row, serializing quota reads,
      // idempotency replays, expiry cleanup, and insertions for one inviter.
      const inviters = await tx.$queryRaw<
        Array<{ id: string; tenantId: string; status: MembershipStatus; tenantStatus: TenantStatus }>
      >`
        SELECT m.id,
               m.tenant_id AS "tenantId",
               m.status,
               t.status    AS "tenantStatus"
        FROM memberships m
        JOIN tenants t ON t.id = m.tenant_id
        WHERE m.id = ${inviterMembershipId}::uuid
        FOR UPDATE OF m, t`;
      const inviter = inviters[0];
      if (!inviter || inviter.status !== MembershipStatus.active) {
        throw new BadRequestException('active membership required');
      }
      if (expectedTenantId && inviter.tenantId !== expectedTenantId) {
        throw new ForbiddenException('inviter membership context mismatch');
      }
      if (inviter.tenantStatus !== TenantStatus.active) {
        throw new BadRequestException('business is not active');
      }

      const now = new Date();
      await tx.invite.updateMany({
        where: { inviterMembershipId: inviter.id, status: InviteStatus.active, expiresAt: { lte: now } },
        data: { status: InviteStatus.expired },
      });

      if (keyHash) {
        const existing = await tx.invite.findUnique({
          where: { inviterMembershipId_idempotencyKeyHash: { inviterMembershipId: inviter.id, idempotencyKeyHash: keyHash } },
          select: { id: true, code: true, email: true, expiresAt: true, status: true, createdAt: true },
        });
        if (existing) {
          if ((existing.email ?? undefined) !== email) {
            throw new ConflictException('Idempotency-Key was already used with a different invite email');
          }
          return existing;
        }
      }

      const [activeCount, todayCount] = await Promise.all([
        tx.invite.count({
          where: { inviterMembershipId: inviter.id, status: InviteStatus.active, expiresAt: { gt: now } },
        }),
        tx.invite.count({
          where: { inviterMembershipId: inviter.id, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
        }),
      ]);
      if (activeCount >= MAX_ACTIVE_INVITES) {
        throw new BadRequestException(`you can have at most ${MAX_ACTIVE_INVITES} active invites`);
      }
      if (todayCount >= MAX_INVITES_PER_DAY) {
        throw new BadRequestException(`daily invite limit reached (${MAX_INVITES_PER_DAY})`);
      }

      for (let attempt = 0; attempt < 8; attempt++) {
        const expiresAt = new Date(now.getTime() + authConfig.inviteTtlMs);
        const inserted = await tx.$queryRaw<
          Array<{ id: string; code: string; email: string | null; expiresAt: Date; status: InviteStatus; createdAt: Date }>
        >`
          INSERT INTO invites
            (tenant_id, inviter_membership_id, code, email, idempotency_key_hash, expires_at, status, created_at, updated_at)
          VALUES
            (${inviter.tenantId}::uuid, ${inviter.id}::uuid, ${randomCode(10)}, ${email}, ${keyHash}, ${expiresAt}, 'active'::"InviteStatus", now(), now())
          ON CONFLICT DO NOTHING
          RETURNING id, code, email, expires_at AS "expiresAt", status, created_at AS "createdAt"`;
        if (inserted.length === 1) return inserted[0];

        // A same-key concurrent replay can only arrive after this transaction
        // releases the inviter lock, but re-check defensively without ever
        // catching a PostgreSQL uniqueness error in an aborted transaction.
        if (keyHash) {
          const existing = await tx.invite.findUnique({
            where: { inviterMembershipId_idempotencyKeyHash: { inviterMembershipId: inviter.id, idempotencyKeyHash: keyHash } },
            select: { id: true, code: true, email: true, expiresAt: true, status: true, createdAt: true },
          });
          if (existing) {
            if ((existing.email ?? undefined) !== email) {
              throw new ConflictException('Idempotency-Key was already used with a different invite email');
            }
            return existing;
          }
        }
      }
      throw new BadRequestException('could not generate invite code');
    }, { maxWait: 30_000, timeout: 30_000 });
  }

  /** Caller-owned invites and statuses; no sales data is exposed for privacy. */
  async listMine(inviterMembershipId: string) {
    this.tenantContext?.assertMembership(inviterMembershipId);
    const invites = await this.prisma.invite.findMany({
      where: { inviterMembershipId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const now = new Date();
    return invites.map((i) => ({
      id: i.id,
      code: i.code,
      email: i.email,
      status: i.status === InviteStatus.active && i.expiresAt < now ? InviteStatus.expired : i.status,
      expiresAt: i.expiresAt,
      usedByMembershipId: i.usedByMembershipId,
      createdAt: i.createdAt,
    }));
  }

  /** Public resolve endpoint: data needed by the /i/{code} registration page. */
  async resolve(code: string) {
    const invite = await this.prisma.invite.findUnique({
      where: { code },
      include: {
        tenant: { select: { name: true, slug: true, status: true, branding: true } },
        inviter: { select: { status: true } },
      },
    });
    if (!invite) {
      throw new NotFoundException('invite not found');
    }
    const valid =
      invite.status === InviteStatus.active &&
      invite.expiresAt > new Date() &&
      invite.tenant.status === TenantStatus.active &&
      invite.inviter.status === MembershipStatus.active;
    return {
      code: invite.code,
      valid,
      tenantName: invite.tenant.name,
      tenantSlug: invite.tenant.slug,
      brand: publicBrandFromTenant(invite.tenant),
      expiresAt: invite.expiresAt,
      emailLocked: invite.email !== null,
    };
  }
}
