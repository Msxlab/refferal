import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EngineService } from '../engine/engine.service';
import { BackgroundJobStatusService } from '../health/background-job-status.service';

/**
 * Scheduled jobs (SPEC 7). matureCommissions runs once across all tenants and is
 * safe with SKIP LOCKED. Without this job, on_delivery/days_after maturation does
 * not happen in production and payable balances remain empty.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;

  constructor(
    private readonly engine: EngineService,
    private readonly backgroundJobStatus: BackgroundJobStatusService,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'mature-commissions' })
  async matureCommissions(): Promise<void> {
    if (this.running) {
      // Skip if the previous run is still active.
      return;
    }
    this.running = true;
    const startedAt = process.hrtime.bigint();
    try {
      let totalMatured = 0;
      for (let batch = 0; batch < 10; batch += 1) {
        const { matured, hasMore } = await this.engine.matureCommissions(new Date(), 100);
        totalMatured += matured;
        if (!hasMore || matured === 0) {
          break;
        }
      }
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      this.backgroundJobStatus.recordMaturationSuccess(durationSeconds);
      this.logger.log(`matured commission rows: ${totalMatured}`);
    } catch (err) {
      this.backgroundJobStatus.recordMaturationFailure();
      this.logger.error('matureCommissions job failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }
}
