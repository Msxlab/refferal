import { Controller, MessageEvent, Query, Sse, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Observable } from 'rxjs';
import { filter, map } from 'rxjs/operators';
import { authConfig } from '../auth/auth.config';
import { Public } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { EventsService } from './events.service';

/**
 * Server-Sent Events (Dalga 3): tarayici EventSource ile canli olay akisi.
 * EventSource header gonderemedigi icin token query'den dogrulanir (@Public + manuel verify).
 * Kiraciya gore filtrelenir — uye yalniz kendi tenant'inin olaylarini gorur.
 */
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Sse('stream')
  stream(@Query('token') token?: string): Observable<MessageEvent> {
    let payload: RequestUser;
    try {
      payload = this.jwt.verify<RequestUser>(token ?? '', { secret: authConfig.accessSecret() });
    } catch {
      throw new UnauthorizedException('gecersiz akis tokeni');
    }
    const tid = payload.tid;
    return this.events.stream().pipe(
      filter((e) => e.tenantId === tid),
      map((e) => ({ type: e.event, data: e.data }) as MessageEvent),
    );
  }
}
