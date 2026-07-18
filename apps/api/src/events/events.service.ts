import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface TenantEvent {
  tenantId: string;
  event: string;
  data: Record<string, unknown>;
}

/**
 * Gercek-zamanli olay yayini (Dalga 3). MVP: in-memory RxJS Subject (tek instance).
 * Cok-instance icin Redis pub/sub'a gecilir (ayni publish/stream arayuzu korunur).
 */
@Injectable()
export class EventsService {
  private readonly subject = new Subject<TenantEvent>();

  publish(tenantId: string, event: string, data: Record<string, unknown> = {}): void {
    this.subject.next({ tenantId, event, data });
  }

  stream(): Observable<TenantEvent> {
    return this.subject.asObservable();
  }
}
