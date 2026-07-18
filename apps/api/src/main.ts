import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { configuredCorsOrigins } from './common/cors';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind Caddy/reverse proxies, resolve the real client IP from X-Forwarded-For.
  // Without this, rate limits, audit IPs, and IP-based detection only see the proxy IP.
  app.set('trust proxy', 1);

  // Security headers for API JSON endpoints. Web headers are handled by Caddy.
  app.use(helmet());

  app.setGlobalPrefix('v1', { exclude: ['healthz', 'metrics'] });
  const origins = configuredCorsOrigins();
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
