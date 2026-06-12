import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, SaleStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { EngineService } from '../engine/engine.service';
import { PrismaService } from '../prisma/prisma.service';
import { parseCsv } from './csv';
import { CreateSaleInput, ListSalesInput } from './sales.types';

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

  /** CSV import → draft satislar. Kolon: referral_code,amount_cents,sale_date,customer_ref?,external_ref? */
  async importCsv(actor: ActorContext, csv: string) {
    const rows = parseCsv(csv);
    if (rows.length < 2) {
      throw new BadRequestException('CSV bos veya yalnizca baslik iceriyor');
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = {
      code: header.indexOf('referral_code'),
      amount: header.indexOf('amount_cents'),
      date: header.indexOf('sale_date'),
      customer: header.indexOf('customer_ref'),
      external: header.indexOf('external_ref'),
    };
    if (idx.code < 0 || idx.amount < 0) {
      throw new BadRequestException('CSV baslik satiri referral_code ve amount_cents icermeli');
    }

    const created: string[] = [];
    const errors: Array<{ line: number; reason: string }> = [];

    for (let r = 1; r < rows.length; r++) {
      const cells = rows[r];
      const code = cells[idx.code]?.trim();
      const amountRaw = cells[idx.amount]?.trim();
      try {
        if (!code) throw new Error('referral_code bos');
        const amount = Number(amountRaw);
        if (!Number.isInteger(amount) || amount <= 0) throw new Error(`gecersiz amount_cents: ${amountRaw}`);

        const seller = await this.resolveSeller(actor.tenantId, { sellerReferralCode: code });
        if (seller.status !== MembershipStatus.active) throw new Error('pasif uye');

        const saleDate = idx.date >= 0 && cells[idx.date]?.trim() ? new Date(cells[idx.date].trim()) : new Date();
        if (Number.isNaN(saleDate.getTime())) throw new Error('gecersiz sale_date');

        const sale = await this.prisma.sale.create({
          data: {
            tenantId: actor.tenantId,
            sellerMembershipId: seller.id,
            amountCents: BigInt(amount),
            saleDate,
            customerRef: idx.customer >= 0 ? cells[idx.customer]?.trim() || undefined : undefined,
            externalRef: idx.external >= 0 ? cells[idx.external]?.trim() || undefined : undefined,
            createdBy: actor.userId,
            status: SaleStatus.draft,
          },
        });
        created.push(sale.id);
      } catch (e) {
        errors.push({ line: r + 1, reason: e instanceof Error ? e.message : 'bilinmeyen hata' });
      }
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
