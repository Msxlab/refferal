import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { authConfig } from '../src/auth/auth.config';
import { encryptSecret } from '../src/common/crypto';
import { EmailAdapter, EmailMessage, PushAdapter, PushMessage } from '../src/notifications/adapters';
import { NotificationRelayService } from '../src/notifications/notification-relay.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/** Outbox relay: drains pending notifications and marks sent/failed/retry (SPEC 5). */
describe('notification relay (integration)', () => {
  let prisma: PrismaService;
  let relay: NotificationRelayService;

  // Fake adapters test the mechanism without touching real SMTP/Expo.
  const sentEmails: EmailMessage[] = [];
  const sentPush: PushMessage[] = [];
  let emailShouldFail = false;

  const email: EmailAdapter = {
    send: async (m) => {
      if (emailShouldFail) throw new Error('SMTP down');
      sentEmails.push(m);
    },
  };
  const push: PushAdapter = { send: async (m) => void sentPush.push(m) };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    relay = new NotificationRelayService(prisma, email, push);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    sentEmails.length = 0;
    sentPush.length = 0;
    emailShouldFail = false;
  });

  async function recipient() {
    const tenant = await createTenant(prisma);
    const [m] = await createChain(prisma, tenant.id, 1);
    return { tenantId: tenant.id, membershipId: m.id, userId: m.userId };
  }

  it('sends email and push notifications and marks them sent', async () => {
    const r = await recipient();
    await prisma.notification.createMany({
      data: [
        {
          tenantId: r.tenantId,
          recipientMembershipId: r.membershipId,
          channel: NotificationChannel.email,
          template: 'verify_email',
          payload: { tokenCiphertext: encryptSecret('abc', authConfig.accessSecret()) },
        },
        { tenantId: r.tenantId, recipientMembershipId: r.membershipId, channel: NotificationChannel.push, template: 'commission_earned', payload: { amountCents: '500000', level: 0 } },
      ],
    });

    const processed = await relay.drainOnce();
    expect(processed).toBe(2);

    const all = await prisma.notification.findMany();
    expect(all.every((n) => n.status === NotificationStatus.sent)).toBe(true);
    expect(all.every((n) => n.sentAt !== null)).toBe(true);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toContain('Verify');
    expect(sentEmails[0].text).toContain('token=abc');
    const emailRow = all.find((n) => n.template === 'verify_email');
    expect(emailRow?.payload).toEqual({ tokenRedacted: true });
    // Push has no token, but dispatch was called best-effort.
    expect(sentPush).toHaveLength(1);
    expect(sentPush[0].tokens).toHaveLength(0);
  });

  it('push: registered device token is included in the send list', async () => {
    const r = await recipient();
    await prisma.device.create({
      data: { userId: r.userId, expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'ios' },
    });
    await prisma.notification.create({
      data: { tenantId: r.tenantId, recipientMembershipId: r.membershipId, channel: NotificationChannel.push, template: 'payout_sent', payload: { totalCents: '100000', period: '2026-06' } },
    });

    await relay.drainOnce();
    expect(sentPush[0].tokens).toEqual(['ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]']);
  });

  it('keeps pending and increments attempts on send error, then fails at cap', async () => {
    const r = await recipient();
    emailShouldFail = true;
    const n = await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'password_reset',
        payload: { tokenCiphertext: encryptSecret('t', authConfig.accessSecret()) },
      },
    });

    // Five attempts: each leaves the row pending until the 5th marks failed.
    for (let i = 1; i <= 5; i++) {
      await relay.drainOnce();
    }
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.attempts).toBe(5);
    expect(after.status).toBe(NotificationStatus.failed);
    expect(after.lastError).toContain('SMTP down');

    // A row that reached the cap is no longer processed.
    const processed = await relay.drainOnce();
    expect(processed).toBe(0);
  });

  it('drainOnce is idempotent: sent rows are not processed again', async () => {
    const r = await recipient();
    await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'payout_sent',
        payload: { totalCents: '100000', period: '2026-06' },
      },
    });
    await relay.drainOnce();
    const second = await relay.drainOnce();
    expect(second).toBe(0);
    expect(sentEmails).toHaveLength(1);
  });
});
