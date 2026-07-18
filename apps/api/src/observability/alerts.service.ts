import { Injectable, Logger } from '@nestjs/common';

/**
 * Kritik alarm kanali (Faz B6). ALERT_WEBHOOK_URL (Slack-uyumlu incoming webhook) tanimliysa
 * oraya POST eder; yoksa yalnizca error-log'lar (her zaman calisir). Ayni alarm throttle'lanir
 * (varsayilan saatte bir) — gece job'u her dakika patlasa bile spam olmaz.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly lastSent = new Map<string, number>();
  private readonly throttleMs = 60 * 60 * 1000;

  async critical(title: string, detail?: string, throttleKey?: string): Promise<void> {
    const key = throttleKey ?? title;
    const now = Date.now();
    if (now - (this.lastSent.get(key) ?? 0) < this.throttleMs) return;
    this.lastSent.set(key, now);

    this.logger.error(`[ALERT] ${title}${detail ? ` — ${detail}` : ''}`);
    const url = process.env.ALERT_WEBHOOK_URL;
    if (!url) return; // webhook tanimli degil → log yeterli (no-op disari)
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: `🚨 Refearn: ${title}${detail ? `\n${detail}` : ''}` }),
      });
    } catch (err) {
      this.logger.error('alert webhook gonderilemedi', err instanceof Error ? err.stack : String(err));
    }
  }
}
