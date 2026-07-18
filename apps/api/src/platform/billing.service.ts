import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Platform billing (Faz C2) — Axtra tenant-sirketleri faturalandirir. MANUEL: odeme platform DISI
 * (cek/havale; Stripe yok). Fatura open uretilir, odeme gelince elle 'paid' isaretlenir.
 */
@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Bir sirketin billing yapilandirmasi + faturalari + acik bakiye. */
  async forTenant(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true, currency: true } });
    if (!tenant) throw new NotFoundException('sirket bulunamadi');
    const [config, invoices] = await Promise.all([
      this.prisma.tenantBilling.findUnique({ where: { tenantId } }),
      this.prisma.invoice.findMany({ where: { tenantId }, orderBy: { period: 'desc' }, take: 100 }),
    ]);
    const outstanding = invoices.filter((i) => i.status === InvoiceStatus.open).reduce((a, i) => a + i.amountCents, 0n);
    return {
      tenant: { id: tenant.id, name: tenant.name, currency: tenant.currency },
      config: config
        ? { monthlyFeeCents: config.monthlyFeeCents.toString(), currency: config.currency, active: config.active, notes: config.notes }
        : null,
      outstandingCents: outstanding.toString(),
      invoices: invoices.map((i) => this.serialize(i)),
    };
  }

  /** Billing yapilandirmasini ayarla (upsert). monthlyFeeCents = aylik sabit ucret (cent). */
  async setConfig(tenantId: string, input: { monthlyFeeCents: bigint; active: boolean; notes?: string | null }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { currency: true } });
    if (!tenant) throw new NotFoundException('sirket bulunamadi');
    await this.prisma.tenantBilling.upsert({
      where: { tenantId },
      create: { tenantId, monthlyFeeCents: input.monthlyFeeCents, currency: tenant.currency, active: input.active, notes: input.notes ?? null },
      update: { monthlyFeeCents: input.monthlyFeeCents, active: input.active, notes: input.notes ?? null },
    });
    return this.forTenant(tenantId);
  }

  /** Tek sirkete bir donem faturasi kes (idempotent: tenant+period unique). active config sart. */
  async issueOne(actorUserId: string, tenantId: string, period: string, dueInDays = 14) {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('gecersiz donem (YYYY-MM bekleniyor)');
    const config = await this.prisma.tenantBilling.findUnique({ where: { tenantId } });
    if (!config || !config.active) throw new BadRequestException('bu sirket icin aktif billing yapilandirmasi yok');
    if (config.monthlyFeeCents <= 0n) throw new BadRequestException('aylik ucret 0 — faturalanacak tutar yok');
    const existing = await this.prisma.invoice.findUnique({ where: { tenantId_period: { tenantId, period } } });
    if (existing) throw new ConflictException(`${period} donemi icin fatura zaten var`);
    const invoice = await this.prisma.invoice.create({
      data: {
        tenantId, period, amountCents: config.monthlyFeeCents, currency: config.currency,
        status: InvoiceStatus.open, dueAt: new Date(Date.now() + dueInDays * 86_400_000),
      },
    });
    await this.audit(actorUserId, tenantId, 'billing.invoice_issued', invoice.id, { period, amountCents: invoice.amountCents.toString() });
    return this.serialize(invoice);
  }

  /** Toplu: TUM aktif billing'li sirketlere bir donem faturasi kes (zaten varsa atla). */
  async issuePeriod(actorUserId: string, period: string, dueInDays = 14) {
    if (!PERIOD_RE.test(period)) throw new BadRequestException('gecersiz donem (YYYY-MM bekleniyor)');
    const configs = await this.prisma.tenantBilling.findMany({ where: { active: true, monthlyFeeCents: { gt: 0 } } });
    let created = 0;
    let skipped = 0;
    for (const c of configs) {
      const existing = await this.prisma.invoice.findUnique({ where: { tenantId_period: { tenantId: c.tenantId, period } } });
      if (existing) { skipped++; continue; }
      const inv = await this.prisma.invoice.create({
        data: {
          tenantId: c.tenantId, period, amountCents: c.monthlyFeeCents, currency: c.currency,
          status: InvoiceStatus.open, dueAt: new Date(Date.now() + dueInDays * 86_400_000),
        },
      });
      await this.audit(actorUserId, c.tenantId, 'billing.invoice_issued', inv.id, { period, amountCents: inv.amountCents.toString(), bulk: true });
      created++;
    }
    return { period, created, skipped };
  }

  /** Odeme geldi → elle 'paid' isaretle (cek/havale referansi note'a). */
  async markPaid(actorUserId: string, invoiceId: string, note?: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('fatura bulunamadi');
    if (inv.status !== InvoiceStatus.open) throw new ConflictException('yalnizca acik fatura odendi isaretlenebilir');
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.paid, paidAt: new Date(), paidNote: note ?? null, markedByUserId: actorUserId },
    });
    await this.audit(actorUserId, inv.tenantId, 'billing.invoice_paid', invoiceId, { period: inv.period, amountCents: inv.amountCents.toString(), note: note ?? null });
    return this.serialize(updated);
  }

  /** Faturayi iptal et (void) — yanlis kesildiyse. */
  async voidInvoice(actorUserId: string, invoiceId: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('fatura bulunamadi');
    if (inv.status === InvoiceStatus.paid) throw new ConflictException('odenmis fatura iptal edilemez');
    const updated = await this.prisma.invoice.update({ where: { id: invoiceId }, data: { status: InvoiceStatus.void } });
    await this.audit(actorUserId, inv.tenantId, 'billing.invoice_void', invoiceId, { period: inv.period });
    return this.serialize(updated);
  }

  /** Platform geneli alacak (AR) ozeti: acik/gecikmis/odenen + sirket bazli acik bakiye. */
  async overview() {
    const invoices = await this.prisma.invoice.findMany({
      include: { tenant: { select: { name: true, slug: true } } },
      orderBy: [{ status: 'asc' }, { issuedAt: 'desc' }],
      take: 500,
    });
    const now = new Date();
    let openCents = 0n;
    let overdueCents = 0n;
    let paidCents = 0n;
    for (const i of invoices) {
      if (i.status === InvoiceStatus.open) {
        openCents += i.amountCents;
        if (i.dueAt && i.dueAt < now) overdueCents += i.amountCents;
      } else if (i.status === InvoiceStatus.paid) {
        paidCents += i.amountCents;
      }
    }
    return {
      totals: { openCents: openCents.toString(), overdueCents: overdueCents.toString(), paidCents: paidCents.toString() },
      invoices: invoices.map((i) => ({
        ...this.serialize(i),
        tenantName: i.tenant.name,
        tenantSlug: i.tenant.slug,
        overdue: i.status === InvoiceStatus.open && !!i.dueAt && i.dueAt < now,
      })),
    };
  }

  private serialize(i: { id: string; tenantId: string; period: string; amountCents: bigint; currency: string; status: InvoiceStatus; issuedAt: Date; dueAt: Date | null; paidAt: Date | null; paidNote: string | null }) {
    return {
      id: i.id,
      tenantId: i.tenantId,
      period: i.period,
      amountCents: i.amountCents.toString(),
      currency: i.currency,
      status: i.status,
      issuedAt: i.issuedAt,
      dueAt: i.dueAt,
      paidAt: i.paidAt,
      paidNote: i.paidNote,
    };
  }

  private async audit(actorUserId: string, tenantId: string, action: string, entityId: string, after: object): Promise<void> {
    await this.prisma.auditLog.create({
      data: { tenantId, actorUserId, action, entity: 'billing', entityId, after: after as Prisma.InputJsonValue },
    });
  }
}
