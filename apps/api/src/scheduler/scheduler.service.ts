import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EngineService } from '../engine/engine.service';
import { FraudService } from '../fraud/fraud.service';
import { PayoutsService } from '../payouts/payouts.service';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import { WebhooksService } from '../webhooks/webhooks.service';
import { captureError } from '../observability/sentry';
import { AlertsService } from '../observability/alerts.service';

export interface JobRun { at: Date; ok: boolean; detail?: string }

/**
 * Zamanlanmis isler (SPEC 7). matureCommissions tum tenant'lar icin tek kosumda
 * calisir (SKIP LOCKED ile guvenli). Bu olmadan on_delivery/days_after olgunlasma
 * uretimde GERCEKLESMEZ — payable hep bos kalir (bkz. DECISIONS "Inceleme bulgulari").
 *
 * Her is runJob() ile sarilir: hata Sentry'ye gider (B4) + son-kosum sagligi izlenir (B5).
 */
@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);
  private running = false;
  private autoRequestRunning = false;
  // B5 job sagligi: her isin son kosum sonucu (process-ici; restart'ta sifirlanir). Health ucu okur.
  private readonly lastRun = new Map<string, JobRun>();
  // B5: sik calisan kritik islerin "takildi" esigi — son kosum bundan eskiyse heartbeat alarmlar.
  private static readonly FRESHNESS_MS: Record<string, number> = {
    'mature-commissions': 20 * 60_000, // 5dk job → 20dk'dan eski = takildi
    'webhook-dispatch': 10 * 60_000, // 1dk job
    'fraud-scan': 3 * 60 * 60_000, // saatlik job
  };

  constructor(
    private readonly engine: EngineService,
    private readonly reports: ReportsService,
    private readonly fraud: FraudService,
    private readonly webhooks: WebhooksService,
    private readonly campaigns: CampaignsService,
    private readonly prisma: PrismaService,
    private readonly payouts: PayoutsService,
    private readonly alerts: AlertsService,
  ) {}

  /** B4+B5+B6: isi sar — son kosum izle, hatayi Sentry'ye + log'a + kritik alarma gonder (job'u dusurme). */
  private async runJob(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
      this.lastRun.set(name, { at: new Date(), ok: true });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      this.lastRun.set(name, { at: new Date(), ok: false, detail });
      captureError(err, { job: name });
      this.logger.error(`${name} job hatasi`, err instanceof Error ? err.stack : String(err));
      void this.alerts.critical(`Zamanlanmis is basarisiz: ${name}`, detail, `job-failed:${name}`);
    }
  }

  /**
   * Nabiz (B6): yarim saatte bir DB + kritik islerin sagligini kontrol et, sorunda alarmla.
   * Throttle AlertsService'te (ayni alarm saatte bir) — surekli arizada spam olmaz.
   */
  @Cron(CronExpression.EVERY_30_MINUTES, { name: 'heartbeat' })
  async heartbeat(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      await this.alerts.critical('Veritabanina erisilemiyor', err instanceof Error ? err.message : String(err), 'db-down');
    }
    const now = Date.now();
    for (const [name, run] of this.lastRun) {
      if (!run.ok) {
        await this.alerts.critical(`Zamanlanmis is basarisiz: ${name}`, run.detail, `job-failed:${name}`);
      }
      const maxAge = SchedulerService.FRESHNESS_MS[name];
      if (maxAge && now - run.at.getTime() > maxAge) {
        await this.alerts.critical(`Zamanlanmis is takildi: ${name}`, `son kosum ${run.at.toISOString()}`, `job-stale:${name}`);
      }
    }
  }

  /** B5: zamanlanmis islerin son kosum sagligi (health endpoint icin). */
  jobHealth(): Array<{ name: string } & JobRun> {
    return [...this.lastRun.entries()].map(([name, r]) => ({ name, ...r }));
  }

  /**
   * Gece (06:00): esigi gecen uyelere OTOMATIK 'requested' cek talebi ac + uyeye bildir (Faz A3).
   * PARA CIKMAZ — admin onayi (decide) hala sart. Tenant.autoRequestPayouts kapaliysa atlanir.
   */
  @Cron(CronExpression.EVERY_DAY_AT_6AM, { name: 'auto-request-payouts' })
  async autoRequestPayouts(): Promise<void> {
    // re-entry guard: onceki kosum (cok-uyeli/yavas) hala suruyorsa atla — ust uste binme
    if (this.autoRequestRunning) return;
    this.autoRequestRunning = true;
    await this.runJob('auto-request-payouts', async () => {
      const { created, skipped } = await this.payouts.autoRequestPayouts();
      if (created > 0) this.logger.log(`otomatik cek talebi: ${created} acildi, ${skipped} atlandi`);
    });
    this.autoRequestRunning = false;
  }

  /** Gece: 30 gunden eski iptal/suresi-dolmus refresh token'lari sil (tablo sinirsiz buyumesin). */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'cleanup-refresh-tokens' })
  async cleanupRefreshTokens(): Promise<void> {
    await this.runJob('cleanup-refresh-tokens', async () => {
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const { count } = await this.prisma.refreshToken.deleteMany({
        where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
      });
      if (count > 0) this.logger.log(`eski refresh token temizlendi: ${count}`);
    });
  }

  /** Saatlik: penceresi biten kampanyalari otomatik finalize et (Dalga 5.2). */
  @Cron(CronExpression.EVERY_HOUR, { name: 'auto-finalize-campaigns' })
  async autoFinalizeCampaigns(): Promise<void> {
    await this.runJob('auto-finalize-campaigns', async () => {
      const { finalized } = await this.campaigns.autoFinalizeEnded();
      if (finalized > 0) this.logger.log(`otomatik finalize edilen kampanya: ${finalized}`);
    });
  }

  /** Her dakika: bekleyen webhook teslimatlarini gonder (HMAC imzali, retry'li). */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'webhook-dispatch' })
  async dispatchWebhooks(): Promise<void> {
    await this.runJob('webhook-dispatch', async () => {
      const { delivered, failed } = await this.webhooks.dispatchPending();
      if (delivered + failed > 0) this.logger.log(`webhook teslimat: ${delivered} ok, ${failed} hata`);
    });
  }

  /** Saatlik fraud taramasi (#11): risk skoru + payout hold. */
  @Cron(CronExpression.EVERY_HOUR, { name: 'fraud-scan' })
  async fraudScan(): Promise<void> {
    await this.runJob('fraud-scan', async () => {
      const { tenants, blocked } = await this.fraud.scanAll();
      if (blocked > 0) this.logger.warn(`[security] fraud taramasi: ${tenants} tenant, ${blocked} bloklu uye`);
    });
  }

  /** Gece: audit zincirini muhurleyip butunlugunu dogrula (#12). */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'seal-audit-chain' })
  async sealAuditChain(): Promise<void> {
    await this.runJob('seal-audit-chain', async () => {
      const { tenants, broken } = await this.reports.sealAllTenants();
      this.logger.log(`audit zinciri muhurlendi: ${tenants} tenant, ${broken} kirik`);
    });
  }

  /** Gece: finansal invariant denetimi (Dalga 3) — sapmayi alarmla. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'verify-financials' })
  async verifyFinancials(): Promise<void> {
    await this.runJob('verify-financials', async () => {
      const { tenants, unhealthy } = await this.reports.verifyAllFinancials();
      this.logger.log(`finansal denetim: ${tenants} tenant, ${unhealthy} sapma`);
    });
  }

  /** Gunluk: zamani gelen rapor aboneliklerini gonder (#18). */
  @Cron(CronExpression.EVERY_DAY_AT_8AM, { name: 'report-digests' })
  async reportDigests(): Promise<void> {
    await this.runJob('report-digests', async () => {
      const { sent } = await this.reports.runDueDigests();
      if (sent > 0) this.logger.log(`rapor digest gonderildi: ${sent} tenant`);
    });
  }

  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'mature-commissions' })
  async matureCommissions(): Promise<void> {
    if (this.running) {
      // onceki kosum hala suruyorsa atla (ust uste binmeyi onle)
      return;
    }
    this.running = true;
    await this.runJob('mature-commissions', async () => {
      const { matured } = await this.engine.matureCommissions();
      if (matured > 0) this.logger.log(`olgunlasan komisyon satiri: ${matured}`);
    });
    this.running = false;
  }
}
