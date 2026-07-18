import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { NotificationChannel, NotificationStatus, Prisma } from '@prisma/client';
import { authConfig } from '../auth/auth.config';
import { decryptSecret, newUuid } from '../common/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_ADAPTER, EmailAdapter, PUSH_ADAPTER, PushAdapter } from './adapters';
import { notificationEnabled } from './preferences';
import { render } from './templates';

const MAX_ATTEMPTS = 5;
const BATCH = 20;
const LEASE_MS = 5 * 60 * 1_000;
const MAX_RETRY_SECONDS = 240;
const EXPIRED_LEASE_ERROR = 'notification lease expired after maximum attempts';
const SENSITIVE_TOKEN_TEMPLATES = new Set(['verify_email', 'password_reset']);
const APP_NAME = (): string => process.env.APP_NAME ?? 'Americana Earn';
const APP_MONOGRAM = (): string => process.env.APP_MONOGRAM ?? 'A';

type ClaimedNotification = {
  id: string;
  recipientMembershipId: string | null;
  recipientUserId: string | null;
  channel: NotificationChannel;
  template: string;
  payload: Prisma.JsonValue;
  attempts: number;
  status: NotificationStatus;
  leaseToken: string;
  availableAt: Date;
};

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Wraps a plain-text body in a simple branded HTML email for readability. */
function toHtml(subject: string, body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;line-height:1.6;color:#2a2f3a">${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="margin:0;background:#eef1f6;padding:24px;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(16,18,24,.08)">
      <tr><td style="background:#0f1115;padding:20px 28px">
        <span style="display:inline-block;width:26px;height:26px;border-radius:7px;background:linear-gradient(135deg,#f4d77e,#bd932f);color:#1a1404;text-align:center;line-height:26px;font-weight:800;font-family:Georgia,serif">${esc(APP_MONOGRAM()).slice(0, 2)}</span>
        <span style="color:#f4f6fb;font-weight:700;font-size:16px;margin-left:10px;vertical-align:middle">${esc(APP_NAME())}</span>
      </td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 16px;font-size:18px;color:#0f1115">${esc(subject)}</h1>
        ${paragraphs}
      </td></tr>
      <tr><td style="padding:16px 28px;border-top:1px solid #eef1f6;color:#8a93a6;font-size:12px">
        You're receiving this because you have an account on ${esc(APP_NAME())}.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    return { ...(payload as Record<string, unknown>) };
  }
  return {};
}

function hydratePayload(payload: unknown): Record<string, unknown> {
  const out = asRecord(payload);
  if (typeof out.tokenCiphertext === 'string' && typeof out.token !== 'string') {
    out.token = decryptSecret(out.tokenCiphertext, authConfig.accessSecret());
  }
  return out;
}

function redactPayload(template: string, payload: unknown): Prisma.InputJsonValue {
  const out = asRecord(payload);
  if (SENSITIVE_TOKEN_TEMPLATES.has(template) || 'token' in out || 'tokenCiphertext' in out) {
    delete out.token;
    delete out.tokenCiphertext;
    out.tokenRedacted = true;
  }
  return out as Prisma.InputJsonObject;
}

function sentPayload(
  template: string,
  payload: unknown,
  outcome: { suppressed?: boolean; channel?: NotificationChannel },
): Prisma.InputJsonValue {
  const out = asRecord(redactPayload(template, payload));
  if (outcome.suppressed) {
    out.suppressed = true;
    out.suppressedChannel = outcome.channel;
  }
  return out as Prisma.InputJsonObject;
}

/**
 * Transactional outbox relay (SPEC 5): drains notification rows written to the database.
 * Lease-token claims allow multiple relay instances while preserving at-least-once delivery.
 * @Interval only runs when ScheduleModule is loaded in production; tests call drainOnce manually.
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
      this.logger.error('outbox relay failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.busy = false;
    }
  }

  /** Processes one batch of pending notifications and returns the processed row count. */
  async drainOnce(): Promise<number> {
    const pending = await this.claimPending();
    if (pending.length === 0) return 0;

    for (const n of pending) {
      if (n.availableAt.getTime() <= Date.now()) {
        this.logger.warn(`notification ${n.id} lease expired before dispatch`);
        continue;
      }
      try {
        const outcome = await this.dispatch(n);
        const result = await this.prisma.notification.updateMany({
          where: {
            id: n.id,
            status: NotificationStatus.processing,
            leaseToken: n.leaseToken,
          },
          data: {
            status: NotificationStatus.sent,
            sentAt: new Date(),
            lastError: null,
            payload: sentPayload(n.template, n.payload, outcome),
            availableAt: null,
            leaseToken: null,
          },
        });
        if (result.count === 0) {
          this.logger.warn(`notification ${n.id} result ignored because its lease is stale`);
        }
      } catch {
        const attempts = n.attempts;
        const message = 'notification delivery failed';
        const finalAttempt = attempts >= MAX_ATTEMPTS;
        const retrySeconds = Math.min(30 * 2 ** (attempts - 1), MAX_RETRY_SECONDS);
        const result = await this.prisma.notification.updateMany({
          where: {
            id: n.id,
            status: NotificationStatus.processing,
            leaseToken: n.leaseToken,
          },
          data: {
            attempts,
            lastError: message.slice(0, 500),
            status: finalAttempt ? NotificationStatus.failed : NotificationStatus.pending,
            availableAt: finalAttempt ? null : new Date(Date.now() + retrySeconds * 1_000),
            leaseToken: null,
          },
        });
        if (result.count === 0) {
          this.logger.warn(`notification ${n.id} failure ignored because its lease is stale`);
        } else {
          this.logger.warn(`notification ${n.id} failed to send (attempt ${attempts}): ${message}`);
        }
      }
    }
    return pending.length;
  }

  private claimPending(): Promise<ClaimedNotification[]> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const expiredAtCap = await tx.$queryRaw<Array<{ id: string; leaseToken: string | null }>>`
        SELECT id, lease_token AS "leaseToken"
        FROM notifications
        WHERE status = 'processing'
          AND available_at <= ${now}
          AND attempts >= ${MAX_ATTEMPTS}
        FOR UPDATE SKIP LOCKED`;
      for (const expired of expiredAtCap) {
        const result = await tx.notification.updateMany({
          where: {
            id: expired.id,
            status: NotificationStatus.processing,
            leaseToken: expired.leaseToken,
          },
          data: {
            status: NotificationStatus.failed,
            availableAt: null,
            leaseToken: null,
            lastError: EXPIRED_LEASE_ERROR.slice(0, 500),
          },
        });
        if (result.count === 0) {
          this.logger.warn(`notification ${expired.id} failure ignored because its lease is stale`);
        }
      }

      const rows = await tx.$queryRaw<Array<{
        id: string;
        recipientMembershipId: string | null;
        recipientUserId: string | null;
        channel: NotificationChannel;
        template: string;
        payload: Prisma.JsonValue;
        attempts: number;
        status: NotificationStatus;
      }>>`
        SELECT id,
               recipient_membership_id AS "recipientMembershipId",
               recipient_user_id AS "recipientUserId",
               channel,
               template,
               payload,
               attempts,
               status
        FROM notifications
        WHERE ((status = 'pending' AND available_at <= ${now})
          OR (status = 'processing' AND available_at <= ${now}))
          AND attempts < ${MAX_ATTEMPTS}
        ORDER BY created_at ASC
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return [];
      const availableAt = new Date(now.getTime() + LEASE_MS);
      return Promise.all(rows.map(async (row) => {
        const leaseToken = newUuid();
        await tx.notification.updateMany({
          where: { id: row.id, status: row.status },
          data: {
            status: NotificationStatus.processing,
            attempts: { increment: 1 },
            leaseToken,
            availableAt,
          },
        });
        return { ...row, attempts: row.attempts + 1, leaseToken, availableAt };
      }));
    });
  }

  private async dispatch(n: {
    recipientMembershipId: string | null;
    recipientUserId: string | null;
    channel: NotificationChannel;
    template: string;
    payload: unknown;
  }): Promise<{ suppressed?: boolean; channel?: NotificationChannel }> {
    const membership = n.recipientMembershipId
      ? await this.prisma.membership.findUnique({
          where: { id: n.recipientMembershipId },
          include: { tenant: { select: { currency: true } }, user: { include: { devices: true } } },
        })
      : null;
    const recipient = membership?.user ?? (n.recipientUserId
      ? await this.prisma.user.findUnique({
          where: { id: n.recipientUserId },
          include: { devices: true },
        })
      : null);
    if (!recipient) throw new Error('notification recipient unavailable');

    if (membership && !notificationEnabled(n.template, n.channel, membership.notificationPrefs)) {
      return { suppressed: true, channel: n.channel };
    }

    const payload = hydratePayload(n.payload);
    const { subject, body } = render(n.template, payload, membership?.tenant.currency);

    if (n.channel === NotificationChannel.in_app) {
      // Inbox channel: the row is already in DB; "sent" means delivered to the user. readAt tracks reads.
      return {};
    }
    if (n.channel === NotificationChannel.email) {
      await this.email.send({ to: recipient.email, subject, text: body, html: toHtml(subject, body) });
    } else {
      const tokens = recipient.devices.map((d) => d.expoPushToken);
      const result = await this.push.send({ tokens, title: subject, body, data: { template: n.template } });
      const invalidTokens = result?.invalidTokens ?? [];
      if (invalidTokens.length > 0) {
        await this.prisma.device.deleteMany({
          where: { userId: recipient.id, expoPushToken: { in: invalidTokens } },
        });
      }
    }
    return {};
  }
}
