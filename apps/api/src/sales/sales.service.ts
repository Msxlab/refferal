import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, SaleStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { EngineService } from '../engine/engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseCsv } from './csv';
import { CreateSaleInput, ImportMapping, ListSalesInput } from './sales.types';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
  ) {}

  /** Satici uyeligini tenant icinde cozer (id veya referral kod). */
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
      throw new NotFoundException('satici uyeligi bu isletmede bulunamadi');
    }
    return seller;
  }

  async create(actor: ActorContext, input: CreateSaleInput) {
    const seller = await this.resolveSeller(actor.tenantId, input);
    if (seller.status !== MembershipStatus.active) {
      throw new BadRequestException('pasif uye adina satis girilemez');
    }
    const sale = await this.prisma.sale.create({
      data: {
        tenantId: actor.tenantId,
        sellerMembershipId: seller.id,
        amountCents: BigInt(input.amountCents),
        saleDate: input.saleDate ?? new Date(),
        customerRef: input.customerRef,
        externalRef: input.externalRef,
        createdBy: actor.userId, // gorevler ayrimi: onaylayan bu kisi olamaz
        status: SaleStatus.draft,
      },
    });
    await this.audit(actor, 'sale.create', sale.id, { amountCents: sale.amountCents.toString() });
    return this.serialize(sale);
  }

  async list(actor: ActorContext, q: ListSalesInput) {
    const where: Prisma.SaleWhereInput = { tenantId: actor.tenantId, status: q.status };

    // tarih araligi
    if (q.from || q.to) {
      where.saleDate = { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) };
    }
    // tutar araligi (BigInt cent)
    if (q.minCents !== undefined || q.maxCents !== undefined) {
      where.amountCents = {
        ...(q.minCents !== undefined ? { gte: BigInt(q.minCents) } : {}),
        ...(q.maxCents !== undefined ? { lte: BigInt(q.maxCents) } : {}),
      };
    }
    // serbest arama: satici adi/kodu + customer/external ref
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

  /** Tenant'a ait oldugunu dogrula, sonra motoru tetikle (idempotent). */
  async approve(actor: ActorContext, saleId: string) {
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.approveSale(saleId, actor.userId);
  }

  async void(actor: ActorContext, saleId: string) {
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.voidSale(saleId, actor.userId);
  }

  async deliver(actor: ActorContext, saleId: string, deliveredAt?: Date) {
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.markDelivered(saleId, deliveredAt);
  }

  /** Toplu approve/void: her satis kendi transaction'inda; tek tek hata toplanir (kismi basari). */
  async bulk(actor: ActorContext, action: 'approve' | 'void', ids: string[]) {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        if (action === 'approve') await this.approve(actor, id);
        else await this.void(actor, id);
        succeeded.push(id);
      } catch (e) {
        failed.push({ id, reason: e instanceof Error ? e.message : 'bilinmeyen hata' });
      }
    }
    return { action, succeeded: succeeded.length, failed };
  }

  /** Satis detayi (cekmece): satici + bu satisin komisyon dokumu (ledger, seviye/lehdar). */
  async detail(actor: ActorContext, saleId: string) {
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
    if (!sale) throw new NotFoundException('satis bu isletmede bulunamadi');
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
   * CSV import sihirbazi → draft satislar. mapping ile istenen basliklar eslestirilir
   * (yoksa varsayilan: referral_code, amount_cents, sale_date, customer_ref, external_ref).
   * preview=true ise HICBIR SEY yazilmaz; her satir icin dogrulama + cozulen satici donulur.
   */
  async importCsv(actor: ActorContext, csv: string, mapping?: ImportMapping, preview = false) {
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new BadRequestException('CSV bos veya yalnizca baslik iceriyor');
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name?: string, fallback?: string): number => {
      const target = (name ?? fallback ?? '').trim().toLowerCase();
      return target ? header.indexOf(target) : -1;
    };
    const idx = {
      code: col(mapping?.code, 'referral_code'),
      amount: col(mapping?.amount, 'amount_cents'),
      date: col(mapping?.date, 'sale_date'),
      customer: col(mapping?.customer, 'customer_ref'),
      external: col(mapping?.external, 'external_ref'),
    };
    if (idx.code < 0 || idx.amount < 0) {
      throw new BadRequestException('Esleme gecersiz: referral_code ve amount_cents kolonlari bulunamadi');
    }

    const created: string[] = [];
    const errors: Array<{ line: number; reason: string }> = [];
    const previewRows: Array<{
      line: number; ok: boolean; code: string; amountCents?: string; saleDate?: string;
      customerRef?: string; sellerName?: string; reason?: string;
    }> = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      if (cells.length === 1 && !cells[0]?.trim()) continue; // bos satir
      const code = cells[idx.code]?.trim() ?? '';
      const amountRaw = cells[idx.amount]?.trim();
      try {
        if (!code) throw new Error('referral_code bos');
        const amount = Number(amountRaw);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error(`gecersiz amount_cents: ${amountRaw}`);

        const seller = await this.resolveSeller(actor.tenantId, { sellerReferralCode: code });
        if (seller.status !== MembershipStatus.active) throw new Error('pasif uye');
        const sellerInfo = await this.prisma.membership.findUnique({
          where: { id: seller.id },
          select: { user: { select: { fullName: true } } },
        });

        const saleDate = idx.date >= 0 && cells[idx.date]?.trim() ? new Date(cells[idx.date].trim()) : new Date();
        if (Number.isNaN(saleDate.getTime())) throw new Error('gecersiz sale_date');
        const customerRef = idx.customer >= 0 ? cells[idx.customer]?.trim() || undefined : undefined;
        const externalRef = idx.external >= 0 ? cells[idx.external]?.trim() || undefined : undefined;

        if (preview) {
          previewRows.push({
            line: r + 1, ok: true, code, amountCents: String(amount),
            saleDate: saleDate.toISOString(), customerRef, sellerName: sellerInfo?.user.fullName,
          });
          continue;
        }

        const sale = await this.prisma.sale.create({
          data: {
            tenantId: actor.tenantId,
            sellerMembershipId: seller.id,
            amountCents: BigInt(amount),
            saleDate,
            customerRef,
            externalRef,
            createdBy: actor.userId,
            status: SaleStatus.draft,
          },
        });
        created.push(sale.id);
      } catch (e) {
        const reason = e instanceof Error ? e.message : 'bilinmeyen hata';
        errors.push({ line: r + 1, reason });
        if (preview) previewRows.push({ line: r + 1, ok: false, code, reason });
      }
    }

    if (preview) {
      return {
        preview: true as const,
        okCount: previewRows.filter((p) => p.ok).length,
        errorCount: previewRows.filter((p) => !p.ok).length,
        rows: previewRows,
      };
    }

    await this.audit(actor, 'sale.import', undefined, { created: created.length, errors: errors.length });
    return { created: created.length, errors };
  }

  private async assertInTenant(tenantId: string, saleId: string): Promise<void> {
    const sale = await this.prisma.sale.findFirst({ where: { id: saleId, tenantId }, select: { id: true } });
    if (!sale) {
      throw new NotFoundException('satis bu isletmede bulunamadi');
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
