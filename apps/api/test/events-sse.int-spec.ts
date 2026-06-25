import { UnauthorizedException, MessageEvent } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Subscription } from 'rxjs';
import { EventsController } from '../src/events/events.controller';
import { EventsService } from '../src/events/events.service';

/** Dalga 3 — SSE event bus: publish/stream + kiraci filtreleme + token dogrulama (DB'siz). */
describe('SSE events (birim)', () => {
  let events: EventsService;

  beforeEach(() => {
    events = new EventsService();
  });

  const controllerWith = (verify: () => unknown) =>
    new EventsController(events, { verify } as unknown as JwtService);

  it('stream yalniz kendi kiracisinin olaylarini verir', async () => {
    const ctrl = controllerWith(() => ({ tid: 't1' }));
    const got: MessageEvent[] = [];
    const sub: Subscription = ctrl.stream('tok').subscribe((e) => got.push(e));

    events.publish('t1', 'sale.created', { saleId: 'a' });
    events.publish('t2', 'sale.created', { saleId: 'b' }); // baska kiraci — sizmamali
    events.publish('t1', 'payout.paid', { count: 2 });

    await new Promise((r) => setImmediate(r));
    sub.unsubscribe();

    expect(got).toEqual([
      { type: 'sale.created', data: { saleId: 'a' } },
      { type: 'payout.paid', data: { count: 2 } },
    ]);
  });

  it('gecersiz token → Unauthorized', () => {
    const ctrl = controllerWith(() => { throw new Error('bad'); });
    expect(() => ctrl.stream('bozuk')).toThrow(UnauthorizedException);
  });
});
