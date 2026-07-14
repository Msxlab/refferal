import { Controller, Get, Header, Req, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { NotificationStatus, TenantStatus } from '@prisma/client';
import { timingSafeEqual } from 'node:crypto';
import { Request } from 'express';
import { Public } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

function configuredMetricsToken(): string | undefined {
  const token = process.env.METRICS_TOKEN?.trim();
  return token || undefined;
}

function presentedMetricsToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const direct = req.headers['x-metrics-token'];
  return Array.isArray(direct) ? direct[0]?.trim() : direct?.trim();
}

function tokenMatches(expected: string, actual: string | undefined): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(@Req() req: Request): Promise<string> {
    const token = configuredMetricsToken();
    if (!token || !tokenMatches(token, presentedMetricsToken(req))) {
      throw new UnauthorizedException('metrics token required');
    }

    const started = Date.now();
    let dbUp = 0;
    let activeTenants = 0;
    let pendingNotifications = 0;
    let failedNotifications = 0;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbUp = 1;
      const [tenants, pending, failed] = await this.prisma.$transaction([
        this.prisma.tenant.count({ where: { status: TenantStatus.active } }),
        this.prisma.notification.count({ where: { status: NotificationStatus.pending } }),
        this.prisma.notification.count({ where: { status: NotificationStatus.failed } }),
      ]);
      activeTenants = tenants;
      pendingNotifications = pending;
      failedNotifications = failed;
    } catch {
      dbUp = 0;
    }
    const mem = process.memoryUsage();
    const duration = (Date.now() - started) / 1000;
    return [
      '# HELP americana_earn_up API process health.',
      '# TYPE americana_earn_up gauge',
      'americana_earn_up 1',
      '# HELP americana_earn_db_up Database health.',
      '# TYPE americana_earn_db_up gauge',
      `americana_earn_db_up ${dbUp}`,
      '# HELP americana_earn_active_tenants Active tenant count.',
      '# TYPE americana_earn_active_tenants gauge',
      `americana_earn_active_tenants ${activeTenants}`,
      '# HELP americana_earn_notifications_pending Pending outbox notifications.',
      '# TYPE americana_earn_notifications_pending gauge',
      `americana_earn_notifications_pending ${pendingNotifications}`,
      '# HELP americana_earn_notifications_failed Failed outbox notifications.',
      '# TYPE americana_earn_notifications_failed gauge',
      `americana_earn_notifications_failed ${failedNotifications}`,
      '# HELP americana_earn_process_uptime_seconds Process uptime.',
      '# TYPE americana_earn_process_uptime_seconds gauge',
      `americana_earn_process_uptime_seconds ${process.uptime().toFixed(3)}`,
      '# HELP americana_earn_process_memory_rss_bytes Process RSS memory.',
      '# TYPE americana_earn_process_memory_rss_bytes gauge',
      `americana_earn_process_memory_rss_bytes ${mem.rss}`,
      '# HELP americana_earn_metrics_duration_seconds Metrics collection duration.',
      '# TYPE americana_earn_metrics_duration_seconds gauge',
      `americana_earn_metrics_duration_seconds ${duration.toFixed(3)}`,
      '',
    ].join('\n');
  }
}
