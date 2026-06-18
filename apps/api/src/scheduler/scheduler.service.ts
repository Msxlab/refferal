import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EngineService } from '../engine/engine.service';
import { FraudService } from '../fraud/fraud.service';
import { PayoutsService } from '../payouts/payouts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { WebhooksService } from '../webhooks/webhooks.service';

/**
 * Zamanlanmis isler (SPEC 7). matureCommissions tum tenant'lar icin tek kosumda
 * calisir (SKIP LOCKED ile guvenli). Bu olmadan on_delivery/days_after olgunlasma
 * uretimde GERCEKLESMEZ — payable hep bos kalir (bkz. DECISIONS "Inceleme bulgulari").
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;
  private autoRequestRunning = false;

  constructor(
    private readonly engine: EngineService,
    private readonly reports: ReportsService,
    private readonly fraud: FraudService,
    private readonly webhooks: WebhooksService,
    private readonly campaigns: CampaignsService,
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
  ) {}

  /**
   * Gece (06:00): esigi gecen uyelere OTOMATIK 'requested' cek talebi ac + uyeye bildir (Faz A3).
   * PARA CIKMAZ — admin onayi (decide) hala sart. Tenant.autoRequestPayouts kapaliysa atlanir.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'auto-request-payouts' })
  async autoRequestPayouts(): Promise<void> {
    // re-entry guard: onceki kosum (cok-uyeli/yavas) hala suruyorsa atla — ust uste binme
    if (this.autoRequestRunning) return;
    this.autoRequestRunning = true;
    try {
      const { created, skipped } = await this.payouts.autoRequestPayouts();
      if (created > 0) this.logger.log(`otomatik cek talebi: ${created} acildi, ${skipped} atlandi`);
    } catch (err) {
      this.logger.error('autoRequestPayouts job hatasi', err instanceof Error ? err.stack : String(err));
    } finally {
      this.autoRequestRunning = false;
    }
  }

  /** Gece: 30 gunden eski iptal/suresi-dolmus refresh token'lari sil (tablo sinirsiz buyumesin). */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'cleanup-refresh-tokens' })
  async cleanupRefreshTokens(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
      });
      if (count > 0) this.logger.log(`eski refresh token temizlendi: ${count}`);
    } catch (err) {
      this.logger.error('cleanupRefreshTokens job hatasi', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Saatlik: penceresi biten kampanyalari otomatik finalize et (Dalga 5.2). */
  @Cron(CronExpression.EVERY_HOUR, { name: 'auto-finalize-campaigns' })
  async autoFinalizeCampaigns(): Promise<void> {
    try {
      const { finalized } = await this.campaigns.autoFinalizeEnded();
      if (finalized > 0) this.logger.log(`otomatik finalize edilen kampanya: ${finalized}`);
    } catch (err) {
      this.logger.error('autoFinalizeCampaigns job hatasi', err instanceof Error ? err.stack : String(err));
    }
  }

  /** Her dakika: bekleyen webhook teslimatlarini gonder (HMAC imzali, retry'li). */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'webhook-dispatch' })
  async dispatchWebhooks(): Promise<void> {
    try {
      const { delivered, failed } = await this.webhooks.dispatchPending();
      if (delivered + failed > 0) this.logger.log(`webhook teslimat: ${delivered} ok, ${failed} hata`);
    } catch (err) {
      this.logger.error('dispatchWebhooks job hatasi', err instanceof Error ? err.stack : String(err));
    }
  }

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

  /** Gece: finansal invariant denetimi (Dalga 3) — sapmayi alarmla. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'verify-financials' })
  async verifyFinancials(): Promise<void> {
    try {
      const { tenants, unhealthy } = await this.reports.verifyAllFinancials();
      this.logger.log(`finansal denetim: ${tenants} tenant, ${unhealthy} sapma`);
    } catch (err) {
      this.logger.error('verifyFinancials job hatasi', err instanceof Error ? err.stack : String(err));
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
