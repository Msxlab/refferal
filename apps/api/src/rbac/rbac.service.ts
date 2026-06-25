import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { ActorContext } from '../common/actor';
import {
  PERMISSION_GROUPS,
  SYSTEM_ROLES,
  TIER_TO_SYSTEM_ROLE,
  defaultPermissionsForTier,
} from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { AssignRoleInput, CreateRoleInput, UpdateRoleInput } from './rbac.types';

@Injectable()
export class RbacService implements OnModuleInit {
  private readonly logger = new Logger(RbacService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Acilista: tum kiraccilarda sistem rolleri var et + bos role_id'leri katmandan geri-doldur. */
  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      for (const t of tenants) {
        await this.ensureSystemRoles(t.id);
        await this.backfillMembershipRoles(t.id);
      }
    } catch (err) {
      this.logger.error('rbac bootstrap hatasi', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Sistem rollerini (owner/admin/finance/support/analyst) idempotent var eder. */
  async ensureSystemRoles(tenantId: string): Promise<void> {
    for (const r of SYSTEM_ROLES) {
      await this.prisma.tenantRole.upsert({
        where: { tenantId_key: { tenantId, key: r.key } },
        // var olan sistem rolunun izinleri kod katalogu ile senkron tutulur (drift'i onler)
        update: { permissions: r.permissions, name: r.name, description: r.description, color: r.color },
        create: {
          tenantId,
          key: r.key,
          name: r.name,
          description: r.description,
          color: r.color,
          isSystem: true,
          permissions: r.permissions,
        },
      });
    }
  }

  /** Ozel rol atanmamis uyelikleri enum katmanindaki sistem roluyle eslestir. */
  private async backfillMembershipRoles(tenantId: string): Promise<void> {
    const roles = await this.prisma.tenantRole.findMany({
      where: { tenantId, isSystem: true },
      select: { id: true, key: true },
    });
    const byKey = new Map(roles.map((r) => [r.key, r.id]));
    for (const [tier, key] of Object.entries(TIER_TO_SYSTEM_ROLE)) {
      const roleId = byKey.get(key);
      if (!roleId) continue;
      await this.prisma.membership.updateMany({
        where: { tenantId, role: tier as Role, roleId: null },
        data: { roleId },
      });
    }
  }

  // --------------------------------------------------------------- katalog

  permissionCatalog() {
    return PERMISSION_GROUPS;
  }

  // ----------------------------------------------------------------- roller

  async listRoles(tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    const roles = await this.prisma.tenantRole.findMany({
      where: { tenantId },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { _count: { select: { memberships: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      color: r.color,
      isSystem: r.isSystem,
      permissions: r.permissions,
      memberCount: r._count.memberships,
    }));
  }

  /** Yukseltme onleme: bir aktor SAHIP OLMADIGI izni role yazamaz/atayamaz (owner/platform haric). */
  private assertGrantable(actorPerms: string[], requested: string[]): void {
    const held = new Set(actorPerms);
    const escalating = requested.filter((p) => !held.has(p));
    if (escalating.length > 0) {
      throw new ForbiddenException(
        `kendinizde olmayan izinleri veremezsiniz: ${escalating.join(', ')}`,
      );
    }
  }

  async createRole(actor: ActorContext, input: CreateRoleInput, actorPerms: string[]) {
    this.tenantContext.assertActor(actor);
    this.assertGrantable(actorPerms, input.permissions);
    const key = await this.uniqueKey(actor.tenantId, input.name);
    const role = await this.prisma.tenantRole.create({
      data: {
        tenantId: actor.tenantId,
        key,
        name: input.name,
        description: input.description,
        color: input.color,
        isSystem: false,
        permissions: input.permissions,
      },
    });
    await this.audit(actor, 'role.create', role.id, null, {
      name: role.name,
      permissions: role.permissions,
    });
    return this.listRoles(actor.tenantId);
  }

  async updateRole(actor: ActorContext, roleId: string, input: UpdateRoleInput, actorPerms: string[]) {
    this.tenantContext.assertActor(actor);
    if (input.permissions) this.assertGrantable(actorPerms, input.permissions);
    const role = await this.prisma.tenantRole.findFirst({
      where: { id: roleId, tenantId: actor.tenantId },
    });
    if (!role) throw new NotFoundException('rol bulunamadi');
    // owner sistem rolu kilitli: tum izinleri tasimak zorunda (god-mode tutarliligi)
    if (role.isSystem && role.key === 'owner') {
      throw new BadRequestException('Owner rolu degistirilemez');
    }
    const before = { name: role.name, permissions: role.permissions };
    const updated = await this.prisma.tenantRole.update({
      where: { id: roleId },
      data: {
        // sistem rolunun adi/anahtari sabit; yalniz izinleri ince ayar yapilabilir
        name: role.isSystem ? undefined : input.name,
        description: input.description === undefined ? undefined : input.description,
        color: input.color === undefined ? undefined : input.color,
        permissions: input.permissions,
      },
    });
    await this.audit(actor, 'role.update', roleId, before, {
      name: updated.name,
      permissions: updated.permissions,
    });
    return this.listRoles(actor.tenantId);
  }

  async deleteRole(actor: ActorContext, roleId: string) {
    this.tenantContext.assertActor(actor);
    const role = await this.prisma.tenantRole.findFirst({
      where: { id: roleId, tenantId: actor.tenantId },
      include: { _count: { select: { memberships: true } } },
    });
    if (!role) throw new NotFoundException('rol bulunamadi');
    if (role.isSystem) throw new BadRequestException('sistem rolu silinemez');
    if (role._count.memberships > 0) {
      throw new ConflictException('bu role atanmis uyeler var; once baska role tasiyin');
    }
    await this.prisma.tenantRole.delete({ where: { id: roleId } });
    await this.audit(actor, 'role.delete', roleId, { name: role.name }, null);
    return this.listRoles(actor.tenantId);
  }

  // ------------------------------------------------------------- kisiler

  /** Yonetim yuzeyi kullanicilari (member olmayan + ozel rol atanmis dahil degil). */
  async listPeople(tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    const people = await this.prisma.membership.findMany({
      where: { tenantId },
      include: {
        user: { select: { id: true, email: true, fullName: true, emailVerifiedAt: true, totpEnabledAt: true } },
        roleRef: { select: { id: true, name: true, color: true, key: true } },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });
    return people.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      fullName: m.user.fullName,
      email: m.user.email,
      tier: m.role,
      role: m.roleRef ? { id: m.roleRef.id, name: m.roleRef.name, color: m.roleRef.color, key: m.roleRef.key } : null,
      status: m.status,
      referralCode: m.referralCode,
      emailVerified: m.user.emailVerifiedAt !== null,
      twoFactor: m.user.totpEnabledAt !== null,
      joinedAt: m.joinedAt,
    }));
  }

  async assignRole(
    actor: ActorContext,
    membershipId: string,
    input: AssignRoleInput,
    actorPerms: string[],
    actorMembershipId: string | null,
  ) {
    this.tenantContext.assertActor(actor);
    // gorevler ayrimi: kendi rolunu/iznini bu ekrandan degistiremezsin (self-escalation onleme)
    if (actorMembershipId && membershipId === actorMembershipId) {
      throw new ForbiddenException('kendi rolunuzu bu ekrandan degistiremezsiniz');
    }
    const m = await this.prisma.membership.findFirst({
      where: { id: membershipId, tenantId: actor.tenantId },
    });
    if (!m) throw new NotFoundException('uyelik bulunamadi');
    if (m.role === Role.tenant_owner) {
      throw new BadRequestException('Owner uyeliginin rolu bu ekrandan degistirilemez');
    }
    if (input.roleId) {
      const role = await this.prisma.tenantRole.findFirst({
        where: { id: input.roleId, tenantId: actor.tenantId },
      });
      if (!role) throw new BadRequestException('rol bu isletmeye ait degil');
      // tavan: sahip olmadigin izinleri tasiyan bir rolu baskasina da atayamazsin
      this.assertGrantable(actorPerms, role.permissions);
    }
    if (input.tier && input.tier !== Role.member) {
      this.assertGrantable(actorPerms, defaultPermissionsForTier(input.tier));
    }

    const nextTier = (input.tier ?? m.role) as Role;
    let nextRoleId: string | null | undefined =
      input.roleId === undefined ? undefined : input.roleId;
    if (nextTier === Role.member) {
      nextRoleId = null;
    } else if (input.tier !== undefined && input.roleId === undefined) {
      const key = TIER_TO_SYSTEM_ROLE[nextTier];
      if (key) {
        const systemRole = await this.prisma.tenantRole.findUnique({
          where: { tenantId_key: { tenantId: actor.tenantId, key } },
          select: { id: true },
        });
        nextRoleId = systemRole?.id ?? null;
      }
    }

    const before = { tier: m.role, roleId: m.roleId };
    const updated = await this.prisma.membership.update({
      where: { id: membershipId },
      data: {
        role: input.tier ?? undefined,
        roleId: nextRoleId,
      },
    });
    await this.audit(actor, 'membership.assign_role', membershipId, before, {
      tier: updated.role,
      roleId: updated.roleId,
    });
    return this.listPeople(actor.tenantId);
  }

  // ---------------------------------------------------------- yardimcilar

  /** Bir uyeligin etkin izin kumesi (JWT'ye gomulur). Owner/platform → tum izinler. */
  async permissionsFor(membership: {
    role: Role;
    roleRefPermissions?: string[] | null;
  }): Promise<string[]> {
    if (membership.role === Role.tenant_owner || membership.role === Role.platform_admin) {
      // guard owner/platform'u zaten gecirir; yine de tutarlilik icin tam kume
      return defaultPermissionsForTier(membership.role);
    }
    if (membership.role === Role.tenant_admin || membership.role === Role.tenant_staff) {
      return membership.roleRefPermissions ?? defaultPermissionsForTier(membership.role);
    }
    return defaultPermissionsForTier(membership.role);
  }

  private async uniqueKey(tenantId: string, name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40) || 'role';
    let key = base;
    let i = 1;
    while (await this.prisma.tenantRole.findUnique({ where: { tenantId_key: { tenantId, key } } })) {
      key = `${base}_${i++}`;
    }
    return key;
  }

  private async audit(
    actor: ActorContext,
    action: string,
    entityId: string,
    before: Prisma.InputJsonValue | null,
    after: Prisma.InputJsonValue | null,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entity: 'rbac',
        entityId,
        before: before ?? Prisma.JsonNull,
        after: after ?? Prisma.JsonNull,
      },
    });
  }
}
