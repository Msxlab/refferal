import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Caddy/reverse-proxy arkasinda: gercek istemci IP'si X-Forwarded-For'dan cozulsun.
  // Bu OLMADAN rate-limit, audit IP'leri ve IP-bazli tespit etkisizdir (hepsi proxy IP'sini gorur).
  app.set('trust proxy', 1);

  // Guvenlik basliklari (API JSON ucları). Web basliklari Caddy'de.
  app.use(helmet());

  app.setGlobalPrefix('v1', { exclude: ['healthz', 'metrics'] });
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
