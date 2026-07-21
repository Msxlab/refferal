import 'reflect-metadata';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipStatus, Role, TenantStatus } from '@prisma/client';
import { EventsController } from '../events/events.controller';
import { AccessTokenGuard } from './auth.guard';

describe('AccessTokenGuard bearer-token contract', () => {
  const updatedAt = new Date('2026-07-21T00:00:00.000Z');

  function contextFor(handler: object, request: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: () => handler,
      getClass: () => EventsController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function guardWith(verifyAsync: jest.Mock, role: Role = Role.tenant_owner) {
    return new AccessTokenGuard(
      { verifyAsync } as never,
      new Reflector(),
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            isPlatformAdmin: false,
            totpEnabledAt: null,
            authGeneration: 1,
          }),
        },
        membership: {
          findFirst: jest.fn().mockResolvedValue({
            role,
            status: MembershipStatus.active,
            updatedAt,
            roleRef: null,
            tenant: { status: TenantStatus.active },
          }),
        },
      } as never,
    );
  }

  it('rejects an EventSource query token so reusable credentials never enter a URL', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: 'user-1',
      mid: 'membership-1',
      tid: 'tenant-1',
      role: Role.tenant_owner,
      authGeneration: 1,
      iat: 0,
      exp: 1,
    });
    const guard = guardWith(verifyAsync);
    const request = { headers: {}, query: { token: 'event-source-token' }, method: 'GET', url: '/v1/events/stream?token=event-source-token' };

    await expect(guard.canActivate(contextFor(EventsController.prototype.stream, request))).rejects.toThrow('erisim tokeni gerekli');
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('accepts a bearer token for the owner/admin event stream and runs regular session checks', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: 'user-1',
      mid: 'membership-1',
      tid: 'tenant-1',
      role: Role.tenant_owner,
      authGeneration: 1,
      iat: 0,
      exp: 1,
    });
    const guard = guardWith(verifyAsync, Role.tenant_owner);
    const request = { headers: { authorization: 'Bearer stream-access-token' }, query: {}, method: 'GET', url: '/v1/events/stream' };

    await expect(guard.canActivate(contextFor(EventsController.prototype.stream, request))).resolves.toBe(true);
    expect(verifyAsync).toHaveBeenCalledWith('stream-access-token', expect.any(Object));
    expect(request).toHaveProperty('user');
  });

  it('rejects a tenant staff bearer token from the owner/admin event stream', async () => {
    const verifyAsync = jest.fn().mockResolvedValue({
      sub: 'user-1',
      mid: 'membership-1',
      tid: 'tenant-1',
      role: Role.tenant_staff,
      authGeneration: 1,
      iat: 0,
      exp: 1,
    });
    const guard = guardWith(verifyAsync, Role.tenant_staff);
    const request = { headers: { authorization: 'Bearer staff-access-token' }, query: {}, method: 'GET', url: '/v1/events/stream' };

    await expect(guard.canActivate(contextFor(EventsController.prototype.stream, request))).rejects.toThrow('permission');
  });
});
