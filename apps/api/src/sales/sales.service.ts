import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipStatus, Prisma, SaleStatus } from '@prisma/client';
import { ActorContext } from '../common/actor';
import { EngineService } from '../engine/engine.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { csvCell } from '../common/csv';
import { parseCsv } from './csv';
import {
  CreateSaleInput,
  ImportMapping,
  ListMySalesInput,
  ListSalesInput,
  SalesFilterInput,
  SelfCreateSaleInput,
} from './sales.types';

// CSV import icin maksimum veri satiri (basligi haric). Export cap (5000) ile tutarli.
const MAX_IMPORT_ROWS = 5000;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly engine: EngineService,
    private readonly events: EventsService,
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

  /** Liste/summary/export icin ortak where insasi — ayni filtre semantigi (tenant-scoped). */
  private buildWhere(tenantId: string, q: SalesFilterInput): Prisma.SaleWhereInput {
    const where: Prisma.SaleWhereInput = { tenantId, status: q.status };

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
    return where;
  }

  async list(actor: ActorContext, q: ListSalesInput) {
    const where = this.buildWhere(actor.tenantId, q);
    const orderBy = { [q.sort]: q.dir } as Prisma.SaleOrderByWithRelationInput;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        orderBy,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { seller: { select: { referralCode: true, userId: true, user: { select: { fullName: true } } } } },
      }),
    ]);

    // Satis basina DAGITILAN net komisyon (commission - reversal): sayfadaki id'ler icin tek groupBy.
    // "Sattigi" (amountCents) ile "kazandirdigi" (commissionCents) yan yana gosterilebilsin (sold-vs-earned).
    const saleIds = rows.map((s) => s.id);
    const ledgerSums = saleIds.length
      ? await this.prisma.ledgerEntry.groupBy({
          by: ['saleId'],
          where: { tenantId: actor.tenantId, saleId: { in: saleIds } },
          _sum: { amountCents: true },
        })
      : [];
    const commBySale = new Map(ledgerSums.map((g) => [g.saleId, g._sum.amountCents ?? 0n]));

    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((s) => ({
        ...this.serialize(s),
        sellerReferralCode: s.seller.referralCode,
        sellerName: s.seller.user.fullName,
        // bu satistan dagitilan toplam komisyon (tum kademeler, ters kayitlar dusulmus)
        commissionCents: (commBySale.get(s.id) ?? 0n).toString(),
        // uyenin kendi girdigi satis mi? (self-servis isareti)
        selfSubmitted: s.createdBy !== null && s.createdBy === s.seller.userId,
      })),
    };
  }

  /** Filtrelenmis kumenin ozeti: adet + toplam/ortalama + statu kirilimi (cent'ler string). */
  async summary(actor: ActorContext, q: SalesFilterInput) {
    const where = this.buildWhere(actor.tenantId, q);
    const [tenant, groups, deliveredCount] = await Promise.all([
      this.prisma.tenant.findUniqueOrThrow({ where: { id: actor.tenantId }, select: { currency: true } }),
      this.prisma.sale.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { amountCents: true } }),
      this.prisma.sale.count({ where: { ...where, deliveredAt: { not: null } } }),
    ]);

    const byStatus: Record<'draft' | 'approved' | 'void', { count: number; amountCents: string }> = {
      draft: { count: 0, amountCents: '0' },
      approved: { count: 0, amountCents: '0' },
      void: { count: 0, amountCents: '0' },
    };
    let count = 0;
    let sum = 0n;
    for (const g of groups) {
      const amount = g._sum.amountCents ?? 0n;
      byStatus[g.status] = { count: g._count._all, amountCents: amount.toString() };
      // void satislar toplam/ortalama KPI'sini sismelesin — yalniz statu kirilimda gosterilir
      if (g.status === SaleStatus.void) continue;
      count += g._count._all;
      sum += amount;
    }

    return {
      currency: tenant.currency,
      count,
      sumCents: sum.toString(),
      // BigInt tam bolme (asagi yuvarlanir) — float'a dusmeden cent hassasiyeti
      avgCents: (count > 0 ? sum / BigInt(count) : 0n).toString(),
      deliveredCount,
      byStatus,
    };
  }

  /** Satis CSV exportu: listeyle ayni filtreler, max 5000 satir, saleDate desc. */
  async exportCsv(actor: ActorContext, q: SalesFilterInput): Promise<string> {
    const where = this.buildWhere(actor.tenantId, q);
    const rows = await this.prisma.sale.findMany({
      where,
      orderBy: { saleDate: 'desc' },
      take: 5000,
      include: { seller: { select: { referralCode: true, user: { select: { fullName: true } } } } },
    });

    const header =
      'id,sale_date,seller_code,seller_name,amount_cents,amount,currency,status,customer_ref,external_ref,approved_at,delivered_at';
    const lines = rows.map((s) => {
      const amount = (Number(s.amountCents) / 100).toFixed(2);
      return [
        s.id,
        s.saleDate.toISOString(),
        csvCell(s.seller.referralCode),
        csvCell(s.seller.user.fullName),
        s.amountCents.toString(),
        amount,
        s.currency,
        s.status,
        csvCell(s.customerRef ?? ''),
        csvCell(s.externalRef ?? ''),
        s.approvedAt?.toISOString() ?? '',
        s.deliveredAt?.toISOString() ?? '',
      ].join(',');
    });
    return [header, ...lines].join('\n') + '\n';
  }

  /** Tenant'a ait oldugunu dogrula, sonra motoru tetikle (idempotent). */
  async approve(actor: ActorContext, saleId: string) {
    await this.assertInTenant(actor.tenantId, saleId);
    const result = await this.engine.approveSale(saleId, actor.userId);
    // canli SSE: onaylanan satis tum panellere aninda yansisin
    this.events.publish(actor.tenantId, 'sale.approved', { saleId });
    return result;
  }

  async void(actor: ActorContext, saleId: string) {
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.voidSale(saleId, actor.userId);
  }

  async deliver(actor: ActorContext, saleId: string, deliveredAt?: Date) {
    await this.assertInTenant(actor.tenantId, saleId);
    return this.engine.markDelivered(saleId, deliveredAt);
  }

  /**
   * Hard delete — YALNIZCA draft. Onaylanmis/void satis ledger'a dokunmustur;
   * duzeltme yolu void/ters kayittir, silme degil. Audit'e tutar/satici snapshot'i yazilir.
   */
  async remove(actor: ActorContext, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId: actor.tenantId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        saleDate: true,
        sellerMembershipId: true,
        seller: { select: { referralCode: true, user: { select: { fullName: true } } } },
      },
    });
    if (!sale) throw new NotFoundException('satis bu isletmede bulunamadi');
    if (sale.status !== SaleStatus.draft) {
      throw new BadRequestException('yalnizca taslak satis silinebilir');
    }
    await this.prisma.sale.delete({ where: { id: sale.id } });
    await this.audit(
      actor,
      'sale.delete',
      saleId,
      { deleted: true },
      {
        amountCents: sale.amountCents.toString(),
        saleDate: sale.saleDate.toISOString(),
        status: sale.status,
        sellerMembershipId: sale.sellerMembershipId,
        sellerReferralCode: sale.seller.referralCode,
        sellerName: sale.seller.user.fullName,
      },
    );
    return { deleted: true };
  }

  /** Toplu aksiyon: her satis kendi transaction'inda; tek tek hata toplanir (kismi basari). */
  async bulk(actor: ActorContext, action: 'approve' | 'void' | 'delete' | 'deliver', ids: string[]) {
    const succeeded: string[] = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const id of ids) {
      try {
        if (action === 'approve') {
          await this.approve(actor, id);
        } else if (action === 'void') {
          await this.void(actor, id);
        } else if (action === 'delete') {
          // yalniz draft silinir; remove() her silineni 'sale.delete' olarak audit'ler
          await this.remove(actor, id);
        } else {
          // yalniz approved + henuz teslim edilmemis olan teslim alinir
          const r = await this.deliver(actor, id);
          if (!r.delivered) throw new BadRequestException('satis zaten teslim edilmis');
        }
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

    // giren/onaylayan ad cozumu: tek batch lookup (her ikisi de null olabilir)
    const actorIds = [sale.createdBy, sale.approvedBy].filter((v): v is string => !!v);
    const actorUsers = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
      : [];
    const nameOf = (id: string | null): string | null => actorUsers.find((u) => u.id === id)?.fullName ?? null;

    return {
      ...this.serialize(sale),
      sellerReferralCode: sale.seller.referralCode,
      sellerName: sale.seller.user.fullName,
      sellerEmail: sale.seller.user.email,
      createdAt: sale.createdAt,
      approvedBy: sale.approvedBy,
      createdByName: nameOf(sale.createdBy),
      approvedByName: nameOf(sale.approvedBy),
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
    // Satir basina seri yazim oldugu icin yukleme boyutunu sinirla (basligi haric).
    if (rows.length - 1 > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`CSV cok fazla satir iceriyor (en fazla ${MAX_IMPORT_ROWS})`);
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

  // ------------------------------------------------------------- uye self-servis (app/sales)

  /** Uye kendi adina satis girer: seller = aktif uyelik, createdBy = kendisi, status = draft. */
  async selfCreate(actor: ActorContext, membershipId: string, input: SelfCreateSaleInput) {
    const seller = await this.resolveSeller(actor.tenantId, { sellerMembershipId: membershipId });
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
        createdBy: actor.userId,
        status: SaleStatus.draft,
      },
    });
    await this.audit(actor, 'sale.self_create', sale.id, { amountCents: sale.amountCents.toString() });
    // canli SSE: admin onay kuyrugu yeni satisi aninda gorsun
    this.events.publish(actor.tenantId, 'sale.created', { saleId: sale.id, sellerMembershipId: seller.id });
    return this.serialize(sale);
  }

  /**
   * Uyenin SADECE kendi satislari + her satis icin kendi komisyon net'i.
   * myCommissionCents: bu uyenin bu satistaki ledger satirlarinin ISARETLI toplami —
   * reversal satirlari negatif amount_cents ile yazilir (engine.voidSale), bu yuzden
   * duz toplam dogru net'i verir (void edilen satis → 0).
   */
  async listMine(actor: ActorContext, membershipId: string, q: ListMySalesInput) {
    const where: Prisma.SaleWhereInput = {
      tenantId: actor.tenantId,
      sellerMembershipId: membershipId,
      status: q.status,
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({
        where,
        orderBy: { saleDate: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);

    const saleIds = rows.map((s) => s.id);
    const sums = saleIds.length
      ? await this.prisma.ledgerEntry.groupBy({
          by: ['saleId'],
          where: { tenantId: actor.tenantId, saleId: { in: saleIds }, beneficiaryMembershipId: membershipId },
          _sum: { amountCents: true },
        })
      : [];
    const sumBySale = new Map(sums.map((g) => [g.saleId, g._sum.amountCents ?? 0n]));

    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((s) => ({
        ...this.serialize(s),
        myCommissionCents: (sumBySale.get(s.id) ?? 0n).toString(),
      })),
    };
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

  private async audit(
    actor: ActorContext,
    action: string,
    entityId: string | undefined,
    after: object,
    before?: object,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        action,
        entity: 'sale',
        entityId: entityId ?? null,
        ...(before ? { before } : {}),
        after,
      },
    });
  }
}

