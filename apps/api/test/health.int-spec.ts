import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTenant, truncateAll } from './helpers';

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
    await createTenant(prisma);

    const res = await request(app.getHttpServer())
      .get('/metrics')
      .set('Authorization', 'Bearer test-metrics-token')
      .expect(200);

    expect(res.text).toContain('americana_earn_up 1');
    expect(res.text).toContain('americana_earn_active_tenants 1');
    expect(res.text).not.toContain('refearn_');
  });
});
