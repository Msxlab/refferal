import { Injectable } from '@nestjs/common';
import { InviteStatus, PayoutSettlementBatchStatus, PayoutStatus, Role, SaleStatus, TenantStatus } from '@prisma/client';
import { RequestUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
  RecommendationAction,
  RecommendationItem,
  RecommendationParams,
  RecommendationResponse,
  RecommendationRoute,
  RecommendationScope,
} from './recommendations.types';

const MAX_RECOMMENDATIONS = 3;
const HOUR_MS = 60 * 60 * 1000;
const INVITE_EXPIRY_WINDOW_MS = 48 * HOUR_MS;
const STALE_PAYOUT_BATCH_AGE_MS = 24 * HOUR_MS;

interface Candidate {
  priority: number;
  item: RecommendationItem;
}

function message(key: string, params: RecommendationParams = {}) {
  return { key, params };
}

function ageHours(now: Date, oldest: Date | null): number {
  if (!oldest) return 0;
  return Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / HOUR_MS));
}

function recommendation(
  key: string,
  priority: number,
  params: RecommendationParams = {},
  path: RecommendationRoute | null = null,
): Candidate {
  const action: RecommendationAction | null = path ? { type: 'navigate', path } : null;
  return {
    priority,
    item: {
      key,
      title: message(`recommendations.${key}.title`, params),
      body: message(`recommendations.${key}.body`, params),
      label: path ? message(`recommendations.${key}.label`) : null,
      action,
    },
  };
}

/** Deterministic, read-only policy layer for safe next-best-action cards. */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async member(user: RequestUser): Promise<RecommendationResponse> {
    const tenantId = user.tid as string;
    const membershipId = user.mid as string;
    const now = new Date();
    const [profile, wallet, expiringInvites] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: user.sub },
        select: { emailVerifiedAt: true, totpEnabledAt: true },
      }),
      this.wallet.wallet(membershipId, tenantId, { page: 1, pageSize: 1 }),
      this.prisma.invite.aggregate({
        where: {
          tenantId,
          inviterMembershipId: membershipId,
          status: InviteStatus.active,
          expiresAt: { gt: now, lte: new Date(now.getTime() + INVITE_EXPIRY_WINDOW_MS) },
        },
        _count: { _all: true },
        _min: { createdAt: true },
      }),
    ]);

    const candidates: Candidate[] = [];
    if (profile?.emailVerifiedAt === null) {
      candidates.push(recommendation('member.email.unverified', 10));
    }

    // WalletService is the canonical source for payout eligibility and its conflict order.
    const payoutEligibility = wallet.payoutEligibility;
    if (payoutEligibility.reason === 'processing') {
      candidates.push(recommendation('member.payout.processing', 20, {}, '/app/wallet'));
    } else if (payoutEligibility.reason === 'requested') {
      candidates.push(recommendation('member.payout.requested', 30, {}, '/app/wallet'));
    } else if (payoutEligibility.requestable) {
      candidates.push(recommendation('member.payout.requestable', 40, {}, '/app/wallet'));
    }

    if (expiringInvites._count._all > 0) {
      candidates.push(
        recommendation(
          'member.invites.expiring',
          50,
          { count: expiringInvites._count._all, oldestAgeHours: ageHours(now, expiringInvites._min.createdAt) },
          '/app/invite',
        ),
      );
    }

    // This endpoint is not MFA-exempt: reaching it means the active route policy permits setup guidance.
    if (profile?.totpEnabledAt === null) {
      candidates.push(recommendation('member.mfa.setup', 60, {}, '/mfa-setup'));
    }
    return this.response('member', candidates, now);
  }

  async tenant(user: RequestUser): Promise<RecommendationResponse> {
    const tenantId = user.tid as string;
    const now = new Date();
    const canViewSales = this.hasPermission(user, 'sales.view');
    const canViewPayouts = this.canAccessPayoutRoute(user);
    const [staleBatches, requestedPayouts, draftSales, deliverySales] = await Promise.all([
      canViewPayouts
        ? this.prisma.payoutBatch.aggregate({
            where: {
              tenantId,
              status: PayoutSettlementBatchStatus.processing,
              processingStartedAt: { lte: new Date(now.getTime() - STALE_PAYOUT_BATCH_AGE_MS) },
            },
            _count: { _all: true },
            _min: { processingStartedAt: true },
          })
        : null,
      canViewPayouts
        ? this.prisma.payout.aggregate({
            where: { tenantId, status: PayoutStatus.requested },
            _count: { _all: true },
            _min: { createdAt: true },
          })
        : null,
      canViewSales
        ? this.prisma.sale.aggregate({
            where: { tenantId, status: SaleStatus.draft },
            _count: { _all: true },
            _min: { createdAt: true },
          })
        : null,
      canViewSales
        ? this.prisma.sale.aggregate({
            where: { tenantId, status: SaleStatus.approved, deliveredAt: null },
            _count: { _all: true },
            _min: { createdAt: true },
          })
        : null,
    ]);

    const candidates: Candidate[] = [];
    if (staleBatches && staleBatches._count._all > 0) {
      candidates.push(
        recommendation(
          'tenant.payouts.processing_stale',
          10,
          { count: staleBatches._count._all, oldestAgeHours: ageHours(now, staleBatches._min.processingStartedAt) },
          '/admin/payouts',
        ),
      );
    }
    if (requestedPayouts && requestedPayouts._count._all > 0) {
      candidates.push(
        recommendation(
          'tenant.payouts.requested',
          20,
          { count: requestedPayouts._count._all, oldestAgeHours: ageHours(now, requestedPayouts._min.createdAt) },
          '/admin/payouts',
        ),
      );
    }
    if (draftSales && draftSales._count._all > 0) {
      candidates.push(
        recommendation(
          'tenant.sales.draft',
          30,
          { count: draftSales._count._all, oldestAgeHours: ageHours(now, draftSales._min.createdAt) },
          '/admin/sales',
        ),
      );
    }
    if (deliverySales && deliverySales._count._all > 0) {
      candidates.push(
        recommendation(
          'tenant.sales.delivery_pending',
          40,
          { count: deliverySales._count._all, oldestAgeHours: ageHours(now, deliverySales._min.createdAt) },
          '/admin/sales',
        ),
      );
    }
    return this.response('tenant', candidates, now);
  }

  async platform(): Promise<RecommendationResponse> {
    const now = new Date();
    const suspendedCount = await this.prisma.tenant.count({ where: { status: TenantStatus.suspended } });
    const candidates =
      suspendedCount > 0
        ? [recommendation('platform.tenants.suspended', 10, { count: suspendedCount }, '/platform')]
        : [];
    return this.response('platform', candidates, now);
  }

  private hasPermission(user: RequestUser, permission: string): boolean {
    return user.role === Role.tenant_owner || user.role === Role.platform_admin || user.perms?.includes(permission) === true;
  }

  private canAccessPayoutRoute(user: RequestUser): boolean {
    return (
      (user.role === Role.tenant_owner || user.role === Role.tenant_admin) &&
      this.hasPermission(user, 'payouts.view')
    );
  }

  private response(scope: RecommendationScope, candidates: Candidate[], generatedAt: Date): RecommendationResponse {
    return {
      scope,
      policyVersion: 'v1',
      generatedAt: generatedAt.toISOString(),
      items: candidates
        .sort((left, right) => left.priority - right.priority || left.item.key.localeCompare(right.item.key))
        .slice(0, MAX_RECOMMENDATIONS)
        .map((candidate) => candidate.item),
    };
  }
}
