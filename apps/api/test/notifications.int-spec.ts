import { NotificationChannel, NotificationStatus } from '@prisma/client';
import { authConfig } from '../src/auth/auth.config';
import { encryptSecret, newUuid } from '../src/common/crypto';
import { EmailAdapter, EmailMessage, PushAdapter, PushMessage } from '../src/notifications/adapters';
import { NotificationRelayService } from '../src/notifications/notification-relay.service';
import { render } from '../src/notifications/templates';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createPlatformAdmin, createTenant, truncateAll } from './helpers';

/** Outbox relay: drains pending notifications and marks sent/failed/retry (SPEC 5). */
describe('notification relay (integration)', () => {
  let prisma: PrismaService;
  let relay: NotificationRelayService;

  // Fake adapters test the mechanism without touching real SMTP/Expo.
  const sentEmails: EmailMessage[] = [];
  const sentPush: PushMessage[] = [];
  let emailShouldFail = false;
  let emailAttempts = 0;

  const email: EmailAdapter = {
    send: async (m) => {
      emailAttempts += 1;
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
    emailAttempts = 0;
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
    expect(all.every((n) => n.availableAt === null)).toBe(true);
    expect(all.every((n) => n.leaseToken === null)).toBe(true);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toContain('Verify');
    expect(sentEmails[0].text).toContain('token=abc');
    const emailRow = all.find((n) => n.template === 'verify_email');
    expect(emailRow?.payload).toEqual({ tokenRedacted: true });
    // Push has no token, but dispatch was called best-effort.
    expect(sentPush).toHaveLength(1);
    expect(sentPush[0].tokens).toHaveLength(0);
  });

  it('uyeligi olmayan dogrudan kullanici e-posta outbox kaydini kullaniciya gonderir', async () => {
    const user = await createPlatformAdmin(prisma, 'Platform-Sifre-42!', 'direct-notification@test.refearn.local');
    const notification = await prisma.notification.create({
      data: {
        tenantId: null,
        recipientMembershipId: null,
        recipientUserId: user.id,
        channel: NotificationChannel.email,
        template: 'password_reset',
        payload: { token: 'direct-user-token' },
      },
    });

    await expect(relay.drainOnce()).resolves.toBe(1);

    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]).toEqual(expect.objectContaining({ to: user.email }));
    const persisted = await prisma.notification.findUniqueOrThrow({ where: { id: notification.id } });
    expect(persisted.status).toBe(NotificationStatus.sent);
  });

  it('veritabani tam olarak bir membership veya user recipient zorunlu kilar', async () => {
    const r = await recipient();

    await expect(
      prisma.notification.create({
        data: {
          tenantId: null,
          recipientMembershipId: null,
          recipientUserId: null,
          channel: NotificationChannel.email,
          template: 'password_reset',
          payload: {},
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.notification.create({
        data: {
          tenantId: r.tenantId,
          recipientMembershipId: r.membershipId,
          recipientUserId: r.userId,
          channel: NotificationChannel.email,
          template: 'password_reset',
          payload: {},
        },
      }),
    ).rejects.toThrow();
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
      if (i < 5) {
        await prisma.notification.update({
          where: { id: n.id },
          data: { availableAt: new Date(Date.now() - 1_000) },
        });
      }
    }
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.attempts).toBe(5);
    expect(after.status).toBe(NotificationStatus.failed);
    expect(after.lastError).toBe('notification delivery failed');
    expect(after.availableAt).toBeNull();
    expect(after.leaseToken).toBeNull();

    // A row that reached the cap is no longer processed.
    const processed = await relay.drainOnce();
    expect(processed).toBe(0);
  });

  it('backs off a transient failure and tick does not hot-loop it', async () => {
    const r = await recipient();
    emailShouldFail = true;
    const before = new Date();
    const n = await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'password_reset',
        payload: { tokenCiphertext: encryptSecret('t', authConfig.accessSecret()) },
      },
    });

    await relay.tick();

    const afterFailure = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(afterFailure.status).toBe(NotificationStatus.pending);
    expect(afterFailure.attempts).toBe(1);
    expect(afterFailure.leaseToken).toBeNull();
    expect(afterFailure.availableAt?.getTime()).toBeGreaterThan(before.getTime());
    expect(emailAttempts).toBe(1);

    await relay.tick();

    const afterSecondTick = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(afterSecondTick.attempts).toBe(1);
    expect(emailAttempts).toBe(1);
  });

  it('schedules the first retry after 30 seconds within clock tolerance', async () => {
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
    const before = Date.now();

    await relay.drainOnce();

    const after = Date.now();
    const retried = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(retried.availableAt?.getTime()).toBeGreaterThanOrEqual(before + 28_000);
    expect(retried.availableAt?.getTime()).toBeLessThanOrEqual(after + 32_000);
  });

  it('caps the fourth-attempt retry schedule at 240 seconds within clock tolerance', async () => {
    const r = await recipient();
    emailShouldFail = true;
    const n = await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'password_reset',
        payload: { tokenCiphertext: encryptSecret('t', authConfig.accessSecret()) },
        attempts: 3,
      },
    });
    const before = Date.now();

    await relay.drainOnce();

    const after = Date.now();
    const retried = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(retried.attempts).toBe(4);
    expect(retried.availableAt?.getTime()).toBeGreaterThanOrEqual(before + 238_000);
    expect(retried.availableAt?.getTime()).toBeLessThanOrEqual(after + 242_000);
  });

  it('does not claim a pending row with null availability', async () => {
    const r = await recipient();
    const n = await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'payout_sent',
        payload: { totalCents: '100000', period: '2026-06' },
        availableAt: null,
      },
    });

    expect(await relay.drainOnce()).toBe(0);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe(NotificationStatus.pending);
    expect(after.attempts).toBe(0);
    expect(emailAttempts).toBe(0);
  });

  it('logs a stale lease when expired-at-cap cleanup updates no row', async () => {
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([{ id: newUuid(), leaseToken: newUuid() }])
      .mockResolvedValueOnce([]);
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const transactionClient = { $queryRaw: queryRaw, notification: { updateMany } };
    const fakePrisma = {
      $transaction: (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient),
    } as unknown as PrismaService;
    const fakeRelay = new NotificationRelayService(fakePrisma, email, push);
    const relayLogger = (fakeRelay as unknown as { logger: { warn: (message: string) => void } }).logger;
    const warn = jest.spyOn(relayLogger, 'warn').mockImplementation(() => undefined);

    expect(await fakeRelay.drainOnce()).toBe(0);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lease is stale'));
  });

  it('dead-letters an expired fifth-attempt processing row without dispatch', async () => {
    const r = await recipient();
    const n = await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'payout_sent',
        payload: { totalCents: '100000', period: '2026-06' },
        status: NotificationStatus.processing,
        attempts: 5,
        leaseToken: newUuid(),
        availableAt: new Date(Date.now() - 1_000),
      },
    });

    expect(await relay.drainOnce()).toBe(0);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe(NotificationStatus.failed);
    expect(after.attempts).toBe(5);
    expect(after.leaseToken).toBeNull();
    expect(after.availableAt).toBeNull();
    expect(after.lastError).toContain('lease expired');
    expect(emailAttempts).toBe(0);
  });

  it('reclaims an expired lower-attempt processing row and sends it', async () => {
    const r = await recipient();
    const n = await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'payout_sent',
        payload: { totalCents: '100000', period: '2026-06' },
        status: NotificationStatus.processing,
        attempts: 2,
        leaseToken: newUuid(),
        availableAt: new Date(Date.now() - 1_000),
      },
    });

    expect(await relay.drainOnce()).toBe(1);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe(NotificationStatus.sent);
    expect(after.attempts).toBe(3);
    expect(after.leaseToken).toBeNull();
    expect(after.availableAt).toBeNull();
    expect(emailAttempts).toBe(1);
  });

  it('prevents a stale claimant from overwriting a newer claimant', async () => {
    const r = await recipient();
    const n = await prisma.notification.create({
      data: {
        tenantId: r.tenantId,
        recipientMembershipId: r.membershipId,
        channel: NotificationChannel.email,
        template: 'payout_sent',
        payload: { totalCents: '100000', period: '2026-06' },
      },
    });

    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstReleased = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEmail: EmailAdapter = {
      send: async () => {
        markFirstStarted();
        await firstReleased;
      },
    };
    const firstRelay = new NotificationRelayService(prisma, firstEmail, push);
    const secondRelay = new NotificationRelayService(prisma, email, push);

    const firstDrain = firstRelay.drainOnce();
    await firstStarted;
    await prisma.notification.update({
      where: { id: n.id },
      data: { availableAt: new Date(Date.now() - 1_000) },
    });

    expect(await secondRelay.drainOnce()).toBe(1);
    const afterSecond = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(afterSecond.status).toBe(NotificationStatus.sent);
    expect(afterSecond.attempts).toBe(2);
    expect(afterSecond.sentAt).not.toBeNull();

    releaseFirst();
    expect(await firstDrain).toBe(1);

    const final = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(final.status).toBe(NotificationStatus.sent);
    expect(final.attempts).toBe(2);
    expect(final.sentAt).toEqual(afterSecond.sentAt);
    expect(final.leaseToken).toBeNull();
    expect(final.availableAt).toBeNull();
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

  it('uses evidence-safe payout wording for current settlement and historical payout_sent payloads', () => {
    const current = render('payout_sent', {
      totalCents: '100000',
      period: '2026-06',
      batchId: 'batch-1',
      settlementReference: 'reference-must-not-leak',
      settlementEvidence: 'evidence-must-not-leak',
      failureReason: 'failure-must-not-leak',
    });
    expect(current.subject).toBe('Payout settled');
    expect(current.body).toContain('Payout settled');

    const historical = render('payout_sent', { totalCents: '100000', period: '2026-06' });
    expect(historical.subject).toBe('Payout status update');
    expect(historical.body).toContain('Payout status update');
    for (const message of [current, historical]) {
      expect(`${message.subject}\n${message.body}`).not.toContain('reference-must-not-leak');
      expect(`${message.subject}\n${message.body}`).not.toContain('evidence-must-not-leak');
      expect(`${message.subject}\n${message.body}`).not.toContain('failure-must-not-leak');
    }
  });
});
