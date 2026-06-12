import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_ADAPTER, EmailAdapter, PUSH_ADAPTER, PushAdapter } from './adapters';
import { render } from './templates';

const MAX_ATTEMPTS = 5;
const BATCH = 20;

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Duz metin govdeyi sade, markali bir HTML e-postaya sarar (inbox teslimati + okunabilirlik). */
function toHtml(subject: string, body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#2a2f3a">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#eef1f6;padding:24px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(16,18,24,.08)">
      <tr><td style="background:#0f1115;padding:20px 28px">
        <span style="display:inline-block;width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#f4d77e,#bd932f);color:#1a1404;text-align:center;line-height:26px;font-weight:800;font-family:Georgia,serif">R</span>
        <span style="color:#f4f6fb;font-weight:700;font-size:16px;margin-left:10px;vertical-align:middle">Refearn</span>
      </td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 16px;font-size:18px;color:#0f1115">${esc(subject)}</h1>
        ${paragraphs}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #eef1f6;color:#8a93a6;font-size:12px">
        You're receiving this because you have an account on Refearn.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

/**
 * Transactional outbox relay (SPEC 5): DB'ye yazilan notifications satirlarini drenaj eder.
 * Tek instance worker (MVP); cok-instance icin BullMQ/claim deseni (DECISIONS).
 * @Interval yalniz ScheduleModule yukluyse calisir (uretim); testte drainOnce elle cagrilir.
 */
@Injectable()
export class NotificationRelayService {
  private readonly logger = new Logger(NotificationRelayService.name);
  private busy = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(PUSH_ADAPTER) private readonly push: PushAdapter,
  ) {}

  @Interval('outbox-relay', 10_000)
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      let processed: number;
      do {
        processed = await this.drainOnce();
      } while (processed === BATCH);
    } catch (err) {
      this.logger.error('outbox relay hatasi', err instanceof Error ? err.stack : String(err));
    } finally {
      this.busy = false;
    }
  }

  /** Bir parti pending bildirimi isler; islenen satir sayisini doner. */
  async drainOnce(): Promise<number> {
    const pending = await this.prisma.notification.findMany({
      where: { status: NotificationStatus.pending, attempts: { lt: MAX_ATTEMPTS } },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
    });
    if (pending.length === 0) return 0;

    for (const n of pending) {
      try {
        await this.dispatch(n);
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { status: NotificationStatus.sent, sentAt: new Date(), attempts: { increment: 1 } },
        });
      } catch (err) {
        const attempts = n.attempts + 1;
        const message = err instanceof Error ? err.message : String(err);
        await this.prisma.notification.update({
          where: { id: n.id },
          data: {
            attempts,
            lastError: message.slice(0, 500),
            // kalici basarisizlik: deneme hakki bitince 'failed'; aksi halde 'pending' (yeniden denenir)
            status: attempts >= MAX_ATTEMPTS ? NotificationStatus.failed : NotificationStatus.pending,
          },
        });
        this.logger.warn(`bildirim ${n.id} gonderilemedi (deneme ${attempts}): ${message}`);
      }
    }
    return pending.length;
  }

  private async dispatch(n: {
    recipientMembershipId: string;
    channel: NotificationChannel;
    template: string;
    payload: unknown;
  }): Promise<void> {
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    const { subject, body } = render(n.template, payload);

    const membership = await this.prisma.membership.findUnique({
      where: { id: n.recipientMembershipId },
      include: { user: { include: { devices: true } } },
    });
    if (!membership) {
      // alici yoksa kalici hata (yeniden denemeye gerek yok)
      throw new Error(`alici uyelik bulunamadi: ${n.recipientMembershipId}`);
    }

    if (n.channel === NotificationChannel.in_app) {
      // gelen kutusu kanali: satir zaten DB'de; "sent" = kullaniciya teslim (okunma readAt ile izlenir)
      return;
    }
    if (n.channel === NotificationChannel.email) {
      await this.email.send({ to: membership.user.email, subject, text: body, html: toHtml(subject, body) });
    } else {
      const tokens = membership.user.devices.map((d) => d.expoPushToken);
      await this.push.send({ tokens, title: subject, body, data: { template: n.template } });
    }
  }
}
