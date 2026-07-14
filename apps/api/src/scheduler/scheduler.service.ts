import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EngineService } from '../engine/engine.service';

/**
 * Scheduled jobs (SPEC 7). matureCommissions runs once across all tenants and is
 * safe with SKIP LOCKED. Without this job, on_delivery/days_after maturation does
 * not happen in production and payable balances remain empty.
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;

  constructor(private readonly engine: EngineService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'mature-commissions' })
  async matureCommissions(): Promise<void> {
    if (this.running) {
      // Skip if the previous run is still active.
      return;
    }
    this.running = true;
    try {
      const { matured } = await this.engine.matureCommissions();
      if (matured > 0) {
        this.logger.log(`matured commission rows: ${matured}`);
      }
    } catch (err) {
      this.logger.error('matureCommissions job failed', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }
}
