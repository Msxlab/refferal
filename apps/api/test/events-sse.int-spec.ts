import { MessageEvent } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Subscription } from 'rxjs';
import { RequestUser } from '../src/auth/auth.types';
import { EventsController } from '../src/events/events.controller';
import { EventsService } from '../src/events/events.service';
import { PrismaService } from '../src/prisma/prisma.service';

/** Dalga 3 — SSE event bus: publish/stream + guard-sonrasi kiraci filtreleme (DB'siz). */
describe('SSE events (birim)', () => {
  let events: EventsService;

  const user = (): RequestUser => ({
    sub: 'user-1',
    mid: 'membership-1',
    tid: 't1',
    role: Role.tenant_owner,
    authGeneration: 1,
    iat: 0,
    exp: 1,
  });

  const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

  const controllerWith = (findFirst: jest.Mock) => new EventsController(
    events,
    { membership: { findFirst } } as unknown as PrismaService,
  );

  beforeEach(() => {
    events = new EventsService();
  });

  it('stream yalniz kendi kiracisinin olaylarini verir', async () => {
    const findFirst = jest.fn().mockResolvedValue({ user: { authGeneration: 1 } });
    const ctrl = controllerWith(findFirst);
    const got: MessageEvent[] = [];
    const sub: Subscription = ctrl.stream(user()).subscribe((e) => got.push(e));

    events.publish('t1', 'sale.created', { saleId: 'a' });
    events.publish('t2', 'sale.created', { saleId: 'b' }); // baska kiraci — sizmamali
    events.publish('t1', 'payout.paid', { count: 2 });

    await flush();
    sub.unsubscribe();

    expect(got).toEqual([
      { type: 'sale.created', data: { saleId: 'a' } },
      { type: 'payout.paid', data: { count: 2 } },
    ]);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'membership-1',
        userId: 'user-1',
        tenantId: 't1',
        role: { in: [Role.tenant_owner, Role.tenant_admin] },
      }),
    }));
  });

  it('does not deliver a later event after the session generation is revoked', async () => {
    const findFirst = jest.fn()
      .mockResolvedValueOnce({ user: { authGeneration: 1 } })
      .mockResolvedValueOnce(null);
    const ctrl = controllerWith(findFirst);
    const got: MessageEvent[] = [];
    const sub = ctrl.stream(user()).subscribe((event) => got.push(event));

    events.publish('t1', 'sale.created', { saleId: 'allowed' });
    await flush();
    events.publish('t1', 'payout.paid', { payoutId: 'revoked' });
    await flush();
    sub.unsubscribe();

    expect(got).toEqual([{ type: 'sale.created', data: { saleId: 'allowed' } }]);
  });

  it('closes an idle stream when its periodic authorization check fails', async () => {
    jest.useFakeTimers();
    try {
      const findFirst = jest.fn().mockResolvedValue(null);
      const ctrl = controllerWith(findFirst);
      let completed = false;
      const sub = ctrl.stream(user()).subscribe({ complete: () => { completed = true; } });

      await jest.advanceTimersByTimeAsync(15_000);

      expect(findFirst).toHaveBeenCalledTimes(1);
      expect(completed).toBe(true);
      sub.unsubscribe();
    } finally {
      jest.useRealTimers();
    }
  });
});
