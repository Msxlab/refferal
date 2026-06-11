import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Saglik ucu (SPEC 10): load balancer / orkestrasyon icin. Global prefix'ten haric
 * (main.ts exclude) → /healthz. Auth gerektirmez, rate-limit'ten muaf.
 */
@Public()
@SkipThrottle()
@Controller('healthz')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    return { status: db ? 'ok' : 'degraded', db, ts: new Date().toISOString() };
  }
}
