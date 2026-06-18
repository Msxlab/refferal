import * as Sentry from '@sentry/node';

let enabled = false;

/**
 * Hata takibi (Faz B4). Sentry yalnizca SENTRY_DSN tanimliysa baslar — yoksa TAM no-op
 * (dis bagimlilik zorunlu degil). main.ts'te app olusmadan ONCE cagrilir.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'production',
    release: process.env.APP_RELEASE,
    // sadece hata yakalama — performans izleme (trace) kapali (maliyet/gurultu)
    tracesSampleRate: 0,
  });
  enabled = true;
}

export function sentryEnabled(): boolean {
  return enabled;
}

/**
 * Beklenmeyen hatayi Sentry'ye gonder (DSN yoksa no-op). Ekstra baglam (route/tenant/job)
 * 'extra' olarak eklenir; tenantId varsa tag yapilir (Sentry'de filtrelenebilsin).
 */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, (scope) => {
    if (context) {
      scope.setExtras(context);
      if (typeof context.tenantId === 'string') scope.setTag('tenantId', context.tenantId);
      if (typeof context.job === 'string') scope.setTag('job', context.job);
    }
    return scope;
  });
}
