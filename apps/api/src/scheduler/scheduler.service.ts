import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EngineService } from '../engine/engine.service';

/**
 * Zamanlanmis isler (SPEC 7). matureCommissions tum tenant'lar icin tek kosumda
 * calisir (SKIP LOCKED ile guvenli). Bu olmadan on_delivery/days_after olgunlasma
 * uretimde GERCEKLESMEZ — payable hep bos kalir (bkz. DECISIONS "Inceleme bulgulari").
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;

  constructor(private readonly engine: EngineService) {}

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'mature-commissions' })
  async matureCommissions(): Promise<void> {
    if (this.running) {
      // onceki kosum hala suruyorsa atla (ust uste binmeyi onle)
      return;
    }
    this.running = true;
    try {
      const { matured } = await this.engine.matureCommissions();
      if (matured > 0) {
        this.logger.log(`olgunlasan komisyon satiri: ${matured}`);
      }
    } catch (err) {
      this.logger.error('matureCommissions job hatasi', err instanceof Error ? err.stack : String(err));
    } finally {
      this.running = false;
    }
  }
}
