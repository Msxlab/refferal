import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, Sale, SaleStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { EngineService } from '../engine/engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { parseCsv } from './csv';
import { CreateSaleInput, ImportMapping, ListSalesInput } from './sales.types';

function isCentsColumn(headerName: string | undefined): boolean {
  const normalized = (headerName ?? '').trim().toLowerCase();
  return normalized === 'amount_cents' || normalized === 'cents' || normalized.endsWith('_cents');
}

const MAX_SAFE_CENTS_TEXT = String(Number.MAX_SAFE_INTEGER);

function parsePositiveSafeCents(value: string, error: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error(error);
  const normalized = value.replace(/^0+/, '') || '0';
  if (
    normalized === '0' ||
    normalized.length > MAX_SAFE_CENTS_TEXT.length ||
    (normalized.length === MAX_SAFE_CENTS_TEXT.length && normalized > MAX_SAFE_CENTS_TEXT)
  ) {
    throw new Error(error);
  }
  return BigInt(normalized);
}

function parseMoneyAmountToCents(raw: string | undefined, assumeCents: boolean): bigint {
  const value = (raw ?? '').trim();
  if (!value) throw new Error('amount is blank');

  if (assumeCents) {
    return parsePositiveSafeCents(value, `invalid amount_cents: ${value}`);
  }

  const normalized = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error(`invalid amount: ${value}`);
  }
  const [dollars, cents = ''] = normalized.split('.');
  return parsePositiveSafeCents(`${dollars}${cents.padEnd(2, '0')}`, `invalid amount: ${value}`);
}

function normalizeExternalRef(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Resolves the seller membership inside the tenant by id or referral code. */
  private async resolveSeller(tenantId: string, input: { sellerMembershipId?: string; sellerReferralCode?: string }) {
    const seller = await this.prisma.membership.findFirst({
      where: {
        tenantId,
        ...(input.sellerMembershipId
          ? { id: input.sellerMembershipId }
          : { referralCode: input.sellerReferralCode }),
      },
      select: { id: true, status: true },
    });
    if (!seller) {
      throw new NotFoundException('seller membership was not found in this business');
    }
    return seller;
  }

  async create(actor: ActorContext, input: CreateSaleInput) {
    this.tenantContext.assertActor(actor);
    const externalRef = normalizeExternalRef(input.externalRef);
    if (externalRef) {
      const existing = await this.findByExternalRef(actor.tenantId, externalRef);
      if (existing) return this.serialize(existing);
    }
    const seller = await this.resolveSeller(actor.tenantId, input);
    if (seller.status !== MembershipStatus.active) {
      throw new BadRequestException('sales cannot be created for inactive members');
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: { currency: true },
    });
    const result = await this.createDraftSale(actor, {
      sellerMembershipId: seller.id,
      amountCents: BigInt(input.amountCents),
      currency: tenant.currency,
      saleDate: input.saleDate ?? new Date(),
      customerRef: input.customerRef,
      externalRef,
    });
    if (result.created) {
      await this.audit(actor, 'sale.create', result.sale.id, { amountCents: result.sale.amountCents.toString() });
    }
    return this.serialize(result.sale);
  }

  async list(actor: ActorContext, q: ListSalesInput) {
    this.tenantContext.assertActor(actor);
    const where: Prisma.SaleWhereInput = { tenantId: actor.tenantId, status: q.status };

    // Date range.
    if (q.from || q.to) {
      where.saleDate = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    // Amount range in BigInt cents.
    if (q.minCents !== undefined || q.maxCents !== undefined) {
      where.amountCents = {
        ...(q.minCents !== undefined ? { gte: BigInt(q.minCents) } : {}),
        ...(q.maxCents !== undefined ? { lte: BigInt(q.maxCents) } : {}),
      };
    }
    // Free search across seller name/code and customer/external references.
    if (q.q) {
      const term = q.q;
      where.OR = [
        { customerRef: { contains: term, mode: 'insensitive' } },
        { externalRef: { contains: term, mode: 'insensitive' } },
        { seller: { referralCode: { contains: term, mode: 'insensitive' } } },
        { seller: { user: { fullName: { contains: term, mode: 'insensitive' } } } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        orderBy: { saleDate: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { seller: { select: { referralCode: true, user: { select: { fullName: true } } } } },
      }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((s) => ({
        ...this.serialize(s),
        sellerReferralCode: s.seller.referralCode,
        sellerName: s.seller.user.fullName,
      })),
    };
  }

  /** Verifies tenant ownership, then triggers the idempotent engine path. */
  async approve(actor: ActorContext, saleId: string) {
    this.tenantContext.assertActor(actor);
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.approveSale(saleId, actor.userId);
  }

  async void(actor: ActorContext, saleId: string) {
    this.tenantContext.assertActor(actor);
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.voidSale(saleId, actor.userId);
  }

  async deliver(actor: ActorContext, saleId: string, deliveredAt?: Date) {
    this.tenantContext.assertActor(actor);
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.markDelivered(saleId, deliveredAt);
  }

  /** Bulk approve/void: each sale uses its own transaction and reports partial failures. */
  async bulk(actor: ActorContext, action: 'approve' | 'void', ids: string[]) {
    this.tenantContext.assertActor(actor);
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        if (action === 'approve') await this.approve(actor, id);
        else await this.void(actor, id);
        succeeded.push(id);
      } catch (e) {
        failed.push({ id, reason: e instanceof Error ? e.message : 'unknown error' });
      }
    }
    return { action, succeeded: succeeded.length, failed };
  }

  /** Sale detail drawer: seller and commission breakdown for this sale. */
  async detail(actor: ActorContext, saleId: string) {
    this.tenantContext.assertActor(actor);
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId: actor.tenantId },
      include: {
        seller: { select: { referralCode: true, user: { select: { fullName: true, email: true } } } },
        ledger: {
          orderBy: [{ level: 'asc' }],
          include: { beneficiary: { select: { referralCode: true, user: { select: { fullName: true } } } } },
        },
      },
    });
    if (!sale) throw new NotFoundException('sale was not found in this business');
    return {
      ...this.serialize(sale),
      sellerReferralCode: sale.seller.referralCode,
      sellerName: sale.seller.user.fullName,
      sellerEmail: sale.seller.user.email,
      createdAt: sale.createdAt,
      approvedBy: sale.approvedBy,
      ledger: sale.ledger.map((e) => ({
        id: e.id,
        level: e.level,
        type: e.type,
        status: e.status,
        rateBpsUsed: e.rateBpsUsed,
        amountCents: e.amountCents.toString(),
        beneficiaryName: e.beneficiary.user.fullName,
        beneficiaryCode: e.beneficiary.referralCode,
        maturesAt: e.maturesAt,
      })),
    };
  }

  /**
   * CSV import wizard -> draft sales. Mapping chooses which headers to read.
   * Defaults to referral_code, amount_cents, sale_date, customer_ref, external_ref when mapping is omitted.
   * When preview=true, writes nothing and returns validation plus resolved seller data for each row.
   */
  async importCsv(actor: ActorContext, csv: string, mapping?: ImportMapping, preview = false) {
    this.tenantContext.assertActor(actor);
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new BadRequestException('CSV is empty or only contains headers');
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name?: string, fallbacks: string[] = []): number => {
      const candidates = [name, ...fallbacks]
        .map((candidate) => (candidate ?? '').trim().toLowerCase())
        .filter(Boolean);
      for (const target of candidates) {
        const found = header.indexOf(target);
        if (found >= 0) return found;
      }
      return -1;
    };
    const idx = {
      code: col(mapping?.code, ['referral_code', 'code', 'seller']),
      amount: col(mapping?.amount, ['amount', 'amount_cents', 'cents']),
      date: col(mapping?.date, ['sale_date']),
      customer: col(mapping?.customer, ['customer_ref']),
      external: col(mapping?.external, ['external_ref']),
    };
    if (idx.code < 0 || idx.amount < 0) {
      throw new BadRequestException('Invalid mapping: referral_code and amount columns were not found');
    }
    const amountIsCents = isCentsColumn(header[idx.amount]);

    const created: string[] = [];
    const skipped: Array<{ line: number; reason: string; saleId?: string }> = [];
    const errors: Array<{ line: number; reason: string }> = [];
    const previewRows: Array<{
      line: number; ok: boolean; code: string; amountCents?: string; saleDate?: string;
      customerRef?: string; sellerName?: string; reason?: string;
    }> = [];
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: actor.tenantId },
      select: { currency: true },
    });

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.length === 1 && !cells[0]?.trim()) continue; // blank row
      const code = cells[idx.code]?.trim() ?? '';
      const amountRaw = cells[idx.amount]?.trim();
      try {
        if (!code) throw new Error('referral_code is blank');
        const amountCents = parseMoneyAmountToCents(amountRaw, amountIsCents);

        const seller = await this.resolveSeller(actor.tenantId, { sellerReferralCode: code });
        if (seller.status !== MembershipStatus.active) throw new Error('inactive member');
        const sellerInfo = await this.prisma.membership.findUnique({
          where: { id: seller.id },
          select: { user: { select: { fullName: true } } },
        });

        const saleDate = idx.date >= 0 && cells[idx.date]?.trim() ? new Date(cells[idx.date].trim()) : new Date();
        if (Number.isNaN(saleDate.getTime())) throw new Error('invalid sale_date');
        const customerRef = idx.customer >= 0 ? cells[idx.customer]?.trim() || undefined : undefined;
        const externalRef = normalizeExternalRef(idx.external >= 0 ? cells[idx.external] : undefined);
        const existing = externalRef ? await this.findByExternalRef(actor.tenantId, externalRef) : null;

        if (preview) {
          previewRows.push({
            line: r + 1, ok: true, code, amountCents: amountCents.toString(),
            saleDate: saleDate.toISOString(), customerRef, sellerName: sellerInfo?.user.fullName,
            reason: existing ? 'external_ref already exists' : undefined,
          });
          continue;
        }

        if (existing) {
          skipped.push({ line: r + 1, reason: 'external_ref already exists', saleId: existing.id });
          continue;
        }

        const result = await this.createDraftSale(actor, {
          sellerMembershipId: seller.id,
          amountCents,
          currency: tenant.currency,
          saleDate,
          customerRef,
          externalRef,
        });
        if (!result.created) {
          skipped.push({ line: r + 1, reason: 'external_ref already exists', saleId: result.sale.id });
          continue;
        }
        created.push(result.sale.id);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'unknown error';
        errors.push({ line: r + 1, reason });
        if (preview) previewRows.push({ line: r + 1, ok: false, code, reason });
      }
    }

    if (preview) {
      return {
        preview: true as const,
        currency: tenant.currency,
        okCount: previewRows.filter((p) => p.ok).length,
        errorCount: previewRows.filter((p) => !p.ok).length,
        rows: previewRows,
      };
    }

    await this.audit(actor, 'sale.import', undefined, { created: created.length, skipped: skipped.length, errors: errors.length });
    return { created: created.length, skipped, errors };
  }

  private async findByExternalRef(tenantId: string, externalRef: string) {
    return this.prisma.sale.findUnique({ where: { tenantId_externalRef: { tenantId, externalRef } } });
  }

  private async createDraftSale(
    actor: ActorContext,
    input: {
      sellerMembershipId: string;
      amountCents: bigint;
      currency: string;
      saleDate: Date;
      customerRef?: string;
      externalRef?: string;
    },
  ): Promise<{ sale: Sale; created: boolean }> {
    const externalRef = normalizeExternalRef(input.externalRef);
    try {
      const sale = await this.prisma.sale.create({
        data: {
          tenantId: actor.tenantId,
          sellerMembershipId: input.sellerMembershipId,
          amountCents: input.amountCents,
          currency: input.currency,
          saleDate: input.saleDate,
          customerRef: input.customerRef,
          externalRef,
          createdBy: actor.userId,
          status: SaleStatus.draft,
        },
      });
      return { sale, created: true };
    } catch (e) {
      if (externalRef && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.findByExternalRef(actor.tenantId, externalRef);
        if (existing) return { sale: existing, created: false };
      }
      throw e;
    }
  }

  private async assertInTenant(tenantId: string, saleId: string): Promise<void> {
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, tenantId }, select: { id: true } });
    if (!sale) {
      throw new NotFoundException('sale was not found in this business');
    }
  }

  private serialize(s: {
    id: string;
    sellerMembershipId: string;
    amountCents: bigint;
    currency: string;
    saleDate: Date;
    status: SaleStatus;
    customerRef: string | null;
    externalRef: string | null;
    approvedAt: Date | null;
    deliveredAt: Date | null;
  }) {
    return {
      id: s.id,
      sellerMembershipId: s.sellerMembershipId,
      amountCents: s.amountCents.toString(),
      currency: s.currency,
      saleDate: s.saleDate,
      status: s.status,
      customerRef: s.customerRef,
      externalRef: s.externalRef,
      approvedAt: s.approvedAt,
      deliveredAt: s.deliveredAt,
    };
  }

  private async audit(actor: ActorContext, action: string, entityId: string | undefined, after: object): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entity: 'sale',
        entityId: entityId ?? null,
        after,
      },
    });
  }
}
