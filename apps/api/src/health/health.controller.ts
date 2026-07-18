import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Health endpoint (SPEC 10) for load balancers and orchestration.
 * Excluded from the global prefix in main.ts, exposed as /healthz, public, and throttle-free.
 */
@Public()
@SkipThrottle()
@Controller('healthz')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        db: false,
        message: 'Database unavailable',
      });
    }
    return { status: 'ok', db: true, ts: new Date().toISOString() };
  }
}
