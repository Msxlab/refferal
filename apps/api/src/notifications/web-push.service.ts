import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface WebPushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * Web Push (VAPID) teslimati — tarayici aboneliklerine bildirim gonderir.
 * VAPID anahtari yoksa no-op (dev'de sessiz). Olu abonelikleri (404/410) otomatik temizler.
 * Cihaz (Expo) push'tan ayri ve ona paralel calisir (relay her ikisini de tetikler).
 */
@Injectable()
export class WebPushService {
  private readonly logger = new Logger('WebPush');
  private readonly enabled: boolean;

  constructor(private readonly prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    this.enabled = Boolean(pub && priv);
    if (this.enabled) {
      webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@refearn.local', pub as string, priv as string);
    } else {
      this.logger.warn('VAPID anahtarlari yok (VAPID_PUBLIC_KEY/PRIVATE_KEY) — web push devre disi.');
    }
  }

  get publicKey(): string | null {
    return process.env.VAPID_PUBLIC_KEY ?? null;
  }

  async subscribe(userId: string, sub: WebPushSubscriptionInput, userAgent?: string): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent },
    });
  }

  async unsubscribe(endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }

  /** Bir kullanicinin TUM tarayici aboneliklerine gonderir; olu aboneligi temizler. */
  async sendToUser(userId: string, payload: { title: string; body: string; data?: Record<string, unknown> }): Promise<void> {
    if (!this.enabled) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return;
    const body = JSON.stringify({ title: payload.title, body: payload.body, data: payload.data ?? {} });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          } else {
            this.logger.debug(`web push hatasi (${status ?? '?'}): ${(err as Error).message}`);
          }
        }
      }),
    );
  }
}
