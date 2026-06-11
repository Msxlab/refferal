import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // /healthz prefix disinda (load balancer); kalan her sey /v1/*
  app.setGlobalPrefix('v1', { exclude: ['healthz'] });
  // CORS: web (admin/app) tarayicidan API'yi cagirir. Origin .env'den (virgulle birden fazla).
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
