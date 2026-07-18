import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LedgerStatus, LedgerType, NotificationChannel, NotificationStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createChain, createSale, createTenant, truncateAll } from './helpers';

describe('health and metrics (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let previousMetricsToken: string | undefined;

  beforeAll(async () => {
    previousMetricsToken = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = 'test-metrics-token';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('v1', { exclude: ['healthz', 'metrics'] });
    await app.init();
    prisma = moduleRef.get(PrismaService);
  });

  afterAll(async () => {
    if (previousMetricsToken === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = previousMetricsToken;
    await app.close();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  it('keeps production readiness public but blocks anonymous metrics', async () => {
    const health = await request(app.getHttpServer()).get('/healthz').expect(200);
    expect(health.body).toEqual(expect.objectContaining({ status: 'ok', db: true }));
    await request(app.getHttpServer()).get('/metrics').expect(401);
    await request(app.getHttpServer()).get('/metrics').set('x-metrics-token', 'wrong').expect(401);
  });

  it('returns Americana Earn metrics only with the configured ops token', async () => {
    const tenant = await createTenant(prisma);
    const [member] = await createChain(prisma, tenant.id, 1);
    const sale = await createSale(prisma, tenant.id, member.id, 1_000n);
    await prisma.ledgerEntry.create({
      data: {
        tenantId: tenant.id,
        saleId: sale.id,
        beneficiaryMembershipId: member.id,
        level: 0,
        rateBpsUsed: 100,
        amountCents: 10n,
        type: LedgerType.commission,
        status: LedgerStatus.pending,
        maturesAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.notification.create({
      data: {
        tenantId: tenant.id,
        recipientMembershipId: member.id,
        channel: NotificationChannel.push,
        template: 'aged-processing-test',
        status: NotificationStatus.processing,
        availableAt: new Date(Date.now() - 6 * 60_000),
      },
    });

    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', 'Bearer test-metrics-token')
      .expect(200);

    expect(res.text).toContain('americana_earn_up 1');
    expect(res.text).toContain('americana_earn_active_tenants 1');
    expect(res.text).toContain('americana_earn_notifications_processing_aged 1');
    expect(res.text).toContain('americana_earn_commissions_maturation_backlog 1');
    expect(res.text).toContain('americana_earn_commissions_maturation_last_success_timestamp_seconds 0');
    expect(res.text).toContain('americana_earn_commissions_maturation_last_duration_seconds 0');
    expect(res.text).toContain('americana_earn_commissions_maturation_failures_total 0');
    expect(res.text).not.toContain('refearn_');
  });
});
