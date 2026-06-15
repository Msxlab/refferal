import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { randomToken } from '../common/crypto';
import { assertSafeWebhookUrl } from '../common/url-safety';
import { PrismaService } from '../prisma/prisma.service';

const MAX_ATTEMPTS = 5;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);
  constructor(private readonly prisma: PrismaService) {}

  // ---- CRUD ----
  async list(tenantId: string) {
    const rows = await this.prisma.webhookEndpoint.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return rows.map((w) => ({ id: w.id, url: w.url, events: w.events, active: w.active, secretPrefix: w.secret.slice(0, 8), createdAt: w.createdAt }));
  }

  async create(tenantId: string, url: string, events: string[]) {
    // SSRF korumasi: kaydetmeden once URL'i dogrula (loopback/private/link-local/reserved reddedilir).
    await assertSafeWebhookUrl(url);
    const w = await this.prisma.webhookEndpoint.create({ data: { tenantId, url, events, secret: `whsec_${randomToken(24)}` } });
    return { id: w.id, url: w.url, events: w.events, secret: w.secret }; // secret yalniz burada tam doner
  }

  async remove(tenantId: string, id: string) {
    const w = await this.prisma.webhookEndpoint.findFirst({ where: { id, tenantId } });
    if (!w) throw new NotFoundException('webhook bulunamadi');
    await this.prisma.webhookEndpoint.delete({ where: { id } });
    return { deleted: true };
  }

  /** Olay yayinla: ilgili (event'e abone veya hepsi) aktif uclar icin teslimat kaydi (pending). */
  async emit(tenantId: string, event: string, payload: Record<string, unknown>): Promise<void> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { tenantId, active: true } });
    const targets = endpoints.filter((e) => e.events.length === 0 || e.events.includes(event));
    if (targets.length === 0) return;
    await this.prisma.webhookDelivery.createMany({
      data: targets.map((e) => ({ endpointId: e.id, event, payload: payload as Prisma.InputJsonValue })),
    });
  }

  async deliveries(tenantId: string) {
    const rows = await this.prisma.webhookDelivery.findMany({
      where: { endpoint: { tenantId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { endpoint: { select: { url: true } } },
    });
    return rows.map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, responseStatus: d.responseStatus, lastError: d.lastError, url: d.endpoint.url, createdAt: d.createdAt }));
  }

  async replay(tenantId: string, id: string) {
    const d = await this.prisma.webhookDelivery.findFirst({ where: { id, endpoint: { tenantId } } });
    if (!d) throw new NotFoundException('teslimat bulunamadi');
    await this.prisma.webhookDelivery.update({ where: { id }, data: { status: 'pending', attempts: 0, lastError: null } });
    return { queued: true };
  }

  /** Test olayi yayinla (UI butonu). */
  async sendTest(tenantId: string): Promise<{ queued: number }> {
    const endpoints = await this.prisma.webhookEndpoint.findMany({ where: { tenantId, active: true } });
    await this.prisma.webhookDelivery.createMany({ data: endpoints.map((e) => ({ endpointId: e.id, event: 'test', payload: { message: 'Refearn test event' } as Prisma.InputJsonValue })) });
    return { queued: endpoints.length };
  }

  // ---- dispatch worker (scheduler) ----
  async dispatchPending(now = new Date()): Promise<{ delivered: number; failed: number }> {
    const due = await this.prisma.webhookDelivery.findMany({
      where: { status: { in: ['pending', 'failed'] }, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: { endpoint: true },
    });
    let delivered = 0;
    let failed = 0;
    for (const d of due) {
      const body = JSON.stringify({ id: d.id, event: d.event, createdAt: d.createdAt.toISOString(), data: d.payload });
      const sig = 'sha256=' + createHmac('sha256', d.endpoint.secret).update(body).digest('hex');
      try {
        // SSRF korumasi: gondermeden hemen once tekrar dogrula (DNS-rebinding/TOCTOU'a karsi).
        await assertSafeWebhookUrl(d.endpoint.url);
        const ctrl = AbortSignal.timeout(8000);
        const res = await fetch(d.endpoint.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Refearn-Event': d.event, 'X-Refearn-Signature': sig },
          body,
          signal: ctrl,
          redirect: 'manual', // 3xx takip etme: Location ic ag'a yonlendirebilir
        });
        if (res.ok) {
          await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'delivered', attempts: d.attempts + 1, responseStatus: res.status, lastError: null } });
          delivered++;
        } else {
          await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'failed', attempts: d.attempts + 1, responseStatus: res.status, lastError: `HTTP ${res.status}` } });
          failed++;
        }
      } catch (e) {
        await this.prisma.webhookDelivery.update({ where: { id: d.id }, data: { status: 'failed', attempts: d.attempts + 1, lastError: e instanceof Error ? e.message.slice(0, 200) : 'error' } });
        failed++;
      }
    }
    void now;
    return { delivered, failed };
  }
}
