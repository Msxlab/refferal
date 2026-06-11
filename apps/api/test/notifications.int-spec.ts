import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { EmailAdapter, EmailMessage, PushAdapter, PushMessage } from '../src/notifications/adapters';
import { NotificationRelayService } from '../src/notifications/notification-relay.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createTenant, truncateAll } from './helpers';

/** Outbox relay: pending bildirimleri drenaj eder, sent/failed/retry isaretler (SPEC 5). */
describe('bildirim relay (entegrasyon)', () => {
  let prisma: PrismaService;
  let relay: NotificationRelayService;

  // sahte adapter'lar — gercek SMTP/Expo'ya gitmeden mekanizmayi test eder
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

  it('e-posta + push bildirimlerini gonderir ve sent isaretler', async () => {
    const r = await recipient();
    await prisma.notification.createMany({
      data: [
        { tenantId: r.tenantId, recipientMembershipId: r.membershipId, channel: NotificationChannel.email, template: 'verify_email', payload: { token: 'abc' } },
        { tenantId: r.tenantId, recipientMembershipId: r.membershipId, channel: NotificationChannel.push, template: 'commission_earned', payload: { amountCents: '500000', level: 0 } },
      ],
    });

    const processed = await relay.drainOnce();
    expect(processed).toBe(2);

    const all = await prisma.notification.findMany();
    expect(all.every((n) => n.status === NotificationStatus.sent)).toBe(true);
    expect(all.every((n) => n.sentAt !== null)).toBe(true);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toContain('dogrulayin');
    // push: token yok ama dispatch cagrildi (best-effort)
    expect(sentPush).toHaveLength(1);
    expect(sentPush[0].tokens).toHaveLength(0);
  });

  it('push: kayitli cihaz token`i varsa gonderim listesine girer', async () => {
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

  it('gonderim hatasinda pending kalir ve attempts artar; cap`e ulasinca failed', async () => {
    const r = await recipient();
    emailShouldFail = true;
    const n = await prisma.notification.create({
      data: { tenantId: r.tenantId, recipientMembershipId: r.membershipId, channel: NotificationChannel.email, template: 'password_reset', payload: { token: 't' } },
    });

    // 5 deneme: her biri pending birakir, 5.'te failed
    for (let i = 1; i <= 5; i++) {
      await relay.drainOnce();
    }
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.attempts).toBe(5);
    expect(after.status).toBe(NotificationStatus.failed);
    expect(after.lastError).toContain('SMTP down');

    // cap'e ulasan satir artik islenmez
    const processed = await relay.drainOnce();
    expect(processed).toBe(0);
  });

  it('drainOnce idempotent: gonderilen satir tekrar islenmez', async () => {
    const r = await recipient();
    await prisma.notification.create({
      data: { tenantId: r.tenantId, recipientMembershipId: r.membershipId, channel: NotificationChannel.email, template: 'team_member_joined', payload: { memberName: 'Ali' } },
    });
    await relay.drainOnce();
    const second = await relay.drainOnce();
    expect(second).toBe(0);
    expect(sentEmails).toHaveLength(1);
  });
});
