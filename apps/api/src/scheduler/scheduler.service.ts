import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EngineService } from '../engine/engine.service';
import { FraudService } from '../fraud/fraud.service';
import { ReportsService } from '../reports/reports.service';

/**
 * Zamanlanmis isler (SPEC 7). matureCommissions tum tenant'lar icin tek kosumda
 * calisir (SKIP LOCKED ile guvenli). Bu olmadan on_delivery/days_after olgunlasma
 * uretimde GERCEKLESMEZ — payable hep bos kalir (bkz. DECISIONS "Inceleme bulgulari").
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;

  constructor(
    private readonly engine: EngineService,
    private readonly reports: ReportsService,
    private readonly fraud: FraudService,
  ) {}

  /** Saatlik fraud taramasi (#11): risk skoru + payout hold. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'fraud-scan' })
  async fraudScan(): Promise<void> {
    try {
      const { tenants, blocked } = await this.fraud.scanAll();
      if (blocked > 0) this.logger.warn(`[security] fraud taramasi: ${tenants} tenant, ${blocked} bloklu uye`);
    } catch (err) {
      this.logger.error('fraudScan job hatasi', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Gece: audit zincirini muhurleyip butunlugunu dogrula (#12). */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'seal-audit-chain' })
  async sealAuditChain(): Promise<void> {
    try {
      const { tenants, broken } = await this.reports.sealAllTenants();
      this.logger.log(`audit zinciri muhurlendi: ${tenants} tenant, ${broken} kirik`);
    } catch (err) {
      this.logger.error('sealAuditChain job hatasi', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Gunluk: zamani gelen rapor aboneliklerini gonder (#18). */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'report-digests' })
  async reportDigests(): Promise<void> {
    try {
      const { sent } = await this.reports.runDueDigests();
      if (sent > 0) this.logger.log(`rapor digest gonderildi: ${sent} tenant`);
    } catch (err) {
      this.logger.error('reportDigests job hatasi', err instanceof Error ? err.stack : String(err));
    }
  }

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
