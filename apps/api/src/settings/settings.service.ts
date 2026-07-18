import { BadRequestException, Injectable } from '@nestjs/common';
import { MaturationRule, Prisma, TenantStatus, type Tenant } from '@prisma/client';
import { constants } from 'node:fs';
import { access, readdir, stat } from 'node:fs/promises';
import * as path from 'node:path';
import { ActorContext } from '../common/actor';
import { PlansService } from '../plans/plans.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';

export interface UpdateSettingsInput {
  name?: string;
  maturationRule?: MaturationRule;
  maturationDays?: number | null;
  payoutMinCents?: bigint;
  timezone?: string;
  notifyNewMemberName?: boolean;
  compressionEnabled?: boolean;
  inactiveMembersEarn?: boolean;
  requireSeparateApprover?: boolean;
  requireKycForPayout?: boolean;
  requirePayoutApproval?: boolean;
  autoRequestPayouts?: boolean;
  branding?: Prisma.InputJsonValue;
}

export interface BackupFileStatus {
  name: string;
  modifiedAt: string;
  sizeBytes: number;
  encrypted: boolean;
}

export interface SettingsDataStatus {
  checkedAt: string;
  database: { ok: boolean; activeTenants: number };
  notifications: { pending: number; processing: number; failed: number };
  backup: { directory: string; readable: boolean; latest: BackupFileStatus | null };
  config: {
    encryptionConfigured: boolean;
    offsiteConfigured: boolean;
    alertConfigured: boolean;
    retentionDays: number;
    minKeep: number;
    intervalSeconds: number;
  };
  restoreTest: { backupScriptPresent: boolean; restoreTestScriptPresent: boolean };
}

function assertValidTimeZone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new BadRequestException('invalid timezone');
  }
}

function assertMaturationConfig(rule: MaturationRule, days: number | null): void {
  if (rule === MaturationRule.days_after_approval && days === null) {
    throw new BadRequestException('maturationDays is required for days_after_approval');
  }
  if (rule !== MaturationRule.days_after_approval && days !== null) {
    throw new BadRequestException('maturationDays must be null unless maturationRule is days_after_approval');
  }
}

function asRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeBrandingPatch(value: Prisma.InputJsonValue | undefined): Record<string, string> | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const patch: Record<string, string> = {};

  if (typeof input.logoText === 'string') {
    patch.logoText = input.logoText.trim().toUpperCase().slice(0, 2);
  }
  if (typeof input.tagline === 'string') {
    patch.tagline = input.tagline.trim().slice(0, 120);
  }
  if (typeof input.primaryColor === 'string') {
    patch.primaryColor = input.primaryColor.toUpperCase();
  }
  if (typeof input.accentColor === 'string') {
    patch.accentColor = input.accentColor.toUpperCase();
  }

  return patch;
}

type SettingsAuditSource = Pick<
  Tenant,
  | 'maturationRule'
  | 'maturationDays'
  | 'payoutMinCents'
  | 'timezone'
  | 'notifyNewMemberName'
  | 'compressionEnabled'
  | 'inactiveMembersEarn'
  | 'requireSeparateApprover'
  | 'requireKycForPayout'
  | 'requirePayoutApproval'
  | 'autoRequestPayouts'
  | 'branding'
>;

function settingsAuditSnapshot(tenant: SettingsAuditSource) {
  return {
    maturationRule: tenant.maturationRule,
    maturationDays: tenant.maturationDays,
    payoutMinCents: tenant.payoutMinCents.toString(),
    timezone: tenant.timezone,
    notifyNewMemberName: tenant.notifyNewMemberName,
    compressionEnabled: tenant.compressionEnabled,
    inactiveMembersEarn: tenant.inactiveMembersEarn,
    requireSeparateApprover: tenant.requireSeparateApprover,
    requireKycForPayout: tenant.requireKycForPayout,
    requirePayoutApproval: tenant.requirePayoutApproval,
    autoRequestPayouts: tenant.autoRequestPayouts,
    branding: tenant.branding,
  };
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plans: PlansService,
    private readonly tenantContext: TenantContextService = new TenantContextService(),
  ) {}

  async get(tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return {
      slug: t.slug,
      name: t.name,
      currency: t.currency,
      timezone: t.timezone,
      maturationRule: t.maturationRule,
      maturationDays: t.maturationDays,
      payoutMinCents: t.payoutMinCents.toString(),
      notifyNewMemberName: t.notifyNewMemberName,
      compressionEnabled: t.compressionEnabled,
      inactiveMembersEarn: t.inactiveMembersEarn,
      requireSeparateApprover: t.requireSeparateApprover,
      requireKycForPayout: t.requireKycForPayout,
      requirePayoutApproval: t.requirePayoutApproval,
      autoRequestPayouts: t.autoRequestPayouts,
      branding: t.branding,
    };
  }

  /** Aktif komisyon planinin bonus katmanlari (MLM unilevel+). */
  async getPlanBonus(tenantId: string) {
    this.tenantContext.assertTenant(tenantId);
    return this.plans.getPlanBonus(tenantId);
  }

  async updatePlanBonus(actor: ActorContext, input: { fastStartBps: number; fastStartDays: number; matchingBps: number }) {
    this.tenantContext.assertActor(actor);
    return this.plans.createBonusVersion(actor, input);
  }

  async update(actor: ActorContext, input: UpdateSettingsInput) {
    this.tenantContext.assertActor(actor);
    await this.prisma.$transaction(async (tx) => {
      const before = await tx.tenant.findUniqueOrThrow({ where: { id: actor.tenantId } });
      const nextRule = input.maturationRule ?? before.maturationRule;
      let nextMaturationDays = input.maturationDays !== undefined ? input.maturationDays : before.maturationDays;
      if (
        nextRule !== MaturationRule.days_after_approval &&
        input.maturationDays !== undefined &&
        input.maturationDays !== null
      ) {
        throw new BadRequestException('maturationDays must be null unless maturationRule is days_after_approval');
      }
      if (nextRule !== MaturationRule.days_after_approval && nextMaturationDays !== null) {
        nextMaturationDays = null;
      }
      const shouldUpdateMaturationDays =
        input.maturationDays !== undefined ||
        input.maturationRule !== undefined ||
        nextMaturationDays !== before.maturationDays;
      assertValidTimeZone(input.timezone ?? before.timezone);
      assertMaturationConfig(nextRule, nextMaturationDays);
      const brandingPatch = normalizeBrandingPatch(input.branding);

      const updated = await tx.tenant.update({
        where: { id: actor.tenantId },
        data: {
          name: input.name,
          maturationRule: input.maturationRule,
          maturationDays: shouldUpdateMaturationDays ? nextMaturationDays : undefined,
          payoutMinCents: input.payoutMinCents,
          timezone: input.timezone,
          notifyNewMemberName: input.notifyNewMemberName,
          compressionEnabled: input.compressionEnabled,
          inactiveMembersEarn: input.inactiveMembersEarn,
          requireSeparateApprover: input.requireSeparateApprover,
          requireKycForPayout: input.requireKycForPayout,
          requirePayoutApproval: input.requirePayoutApproval,
          autoRequestPayouts: input.autoRequestPayouts,
          branding:
            brandingPatch === undefined
              ? undefined
              : ({ ...asRecord(before.branding), ...brandingPatch } as Prisma.InputJsonValue),
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: actor.tenantId,
          actorUserId: actor.userId,
          action: 'tenant.update_settings',
          entity: 'tenant',
          entityId: actor.tenantId,
          before: { name: before.name, ...settingsAuditSnapshot(before) },
          after: { name: updated.name, ...settingsAuditSnapshot(updated) },
        },
      });
    });
    return this.get(actor.tenantId);
  }

  async dataStatus(tenantId: string): Promise<SettingsDataStatus> {
    this.tenantContext.assertTenant(tenantId);
    const [tenantCount, notificationCounts, backup, scripts] = await Promise.all([
      this.prisma.tenant.count({ where: { id: tenantId, status: TenantStatus.active } }),
      this.prisma.notification.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.backupStatus(),
      this.scriptStatus(),
    ]);
    const count = (status: string) =>
      notificationCounts.find((row) => row.status === status)?._count._all ?? 0;

    return {
      checkedAt: new Date().toISOString(),
      database: {
        ok: true,
        activeTenants: tenantCount,
      },
      notifications: {
        pending: count('pending'),
        processing: count('processing'),
        failed: count('failed'),
      },
      backup,
      config: {
        encryptionConfigured: !!process.env.BACKUP_AGE_RECIPIENT,
        offsiteConfigured: !!process.env.BACKUP_OFFSITE_CMD,
        alertConfigured: !!process.env.BACKUP_ALERT_CMD,
        retentionDays: Number(process.env.BACKUP_RETENTION_DAYS ?? process.env.RETENTION_DAYS ?? 30),
        minKeep: Number(process.env.BACKUP_MIN_KEEP ?? 3),
        intervalSeconds: Number(process.env.BACKUP_INTERVAL_SECONDS ?? 86_400),
      },
      restoreTest: scripts,
    };
  }

  private async backupStatus(): Promise<{
    directory: string;
    readable: boolean;
    latest: BackupFileStatus | null;
  }> {
    const directory = process.env.BACKUP_DIR ?? '/backups';
    const prefix = `${process.env.BACKUP_PREFIX ?? 'americana_earn'}_`;
    try {
      await access(directory, constants.R_OK);
      const files = await readdir(directory);
      const backups = await Promise.all(
        files
          .filter((name) => name.startsWith(prefix) && !name.endsWith('.part'))
          .map(async (name) => {
            const fullPath = path.join(directory, name);
            const info = await stat(fullPath);
            return {
              name,
              modifiedAt: info.mtime.toISOString(),
              sizeBytes: info.size,
              encrypted: name.endsWith('.age'),
            };
          }),
      );
      backups.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
      return { directory, readable: true, latest: backups[0] ?? null };
    } catch {
      return { directory, readable: false, latest: null };
    }
  }

  private async scriptStatus(): Promise<{ backupScriptPresent: boolean; restoreTestScriptPresent: boolean }> {
    const candidates = [
      process.cwd(),
      path.resolve(process.cwd(), '..', '..'),
      path.resolve(process.cwd(), '..'),
    ];
    const exists = async (relativePath: string) => {
      for (const root of candidates) {
        try {
          await access(path.join(root, relativePath), constants.R_OK);
          return true;
        } catch {
          // try next candidate
        }
      }
      return false;
    };
    return {
      backupScriptPresent: await exists(path.join('docker', 'backup', 'backup.sh')),
      restoreTestScriptPresent: await exists(path.join('docker', 'backup', 'restore-test.sh')),
    };
  }
}
