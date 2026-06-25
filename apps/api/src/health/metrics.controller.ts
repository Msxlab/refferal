import { Controller, Get, Header } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { NotificationStatus, TenantStatus } from '@prisma/client';
import { Public } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';

@Public()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
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
      '# HELP refearn_up API process health.',
      '# TYPE refearn_up gauge',
      'refearn_up 1',
      '# HELP refearn_db_up Database health.',
      '# TYPE refearn_db_up gauge',
      `refearn_db_up ${dbUp}`,
      '# HELP refearn_active_tenants Active tenant count.',
      '# TYPE refearn_active_tenants gauge',
      `refearn_active_tenants ${activeTenants}`,
      '# HELP refearn_notifications_pending Pending outbox notifications.',
      '# TYPE refearn_notifications_pending gauge',
      `refearn_notifications_pending ${pendingNotifications}`,
      '# HELP refearn_notifications_failed Failed outbox notifications.',
      '# TYPE refearn_notifications_failed gauge',
      `refearn_notifications_failed ${failedNotifications}`,
      '# HELP refearn_process_uptime_seconds Process uptime.',
      '# TYPE refearn_process_uptime_seconds gauge',
      `refearn_process_uptime_seconds ${process.uptime().toFixed(3)}`,
      '# HELP refearn_process_memory_rss_bytes Process RSS memory.',
      '# TYPE refearn_process_memory_rss_bytes gauge',
      `refearn_process_memory_rss_bytes ${mem.rss}`,
      '# HELP refearn_metrics_duration_seconds Metrics collection duration.',
      '# TYPE refearn_metrics_duration_seconds gauge',
      `refearn_metrics_duration_seconds ${duration.toFixed(3)}`,
      '',
    ].join('\n');
  }
}
