import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { Request } from 'express';
import { captureError } from '../observability/sentry';

/**
 * Global hata filtresi (Faz B4): VARSAYILAN Nest yanitini birebir KORUR (super.catch) +
 * 5xx / beklenmeyen hatalari Sentry'ye raporlar. 4xx (beklenen iş kurali reddi) raporlanMAZ.
 * Yanit sekli degismez → frontend ApiError (body.message) etkilenmez.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) {
      const req = host.switchToHttp().getRequest<Request & { user?: { sub?: string; tid?: string | null } }>();
      captureError(exception, {
        method: req?.method,
        url: req?.url,
        userId: req?.user?.sub,
        tenantId: req?.user?.tid ?? undefined,
      });
    }
    super.catch(exception, host);
  }
}
