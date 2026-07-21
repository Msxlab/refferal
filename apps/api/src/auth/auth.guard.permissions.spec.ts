import 'reflect-metadata';
import { ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipStatus, Role, TenantStatus } from '@prisma/client';
import { AccessTokenGuard, RequirePermission } from './auth.guard';

class SinglePermissionRoute {
  @RequirePermission('network.view')
  handler() {}
}

class CombinedPermissionRoute {
  @RequirePermission('network.view', 'network.financials.view')
  handler() {}
}

describe('AccessTokenGuard combined permission contract', () => {
  async function canAccess(
    route: object,
    permissions: string[],
    url = '/test',
  ): Promise<boolean> {
    const updatedAt = new Date('2026-07-20T00:00:00.000Z');
    const guard = new AccessTokenGuard(
      {
        verifyAsync: jest.fn().mockResolvedValue({
          sub: 'user-1',
          mid: 'membership-1',
          tid: 'tenant-1',
          role: Role.tenant_staff,
          authGeneration: 1,
          iat: 0,
          exp: 1,
        }),
      } as never,
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
            role: Role.tenant_staff,
            status: MembershipStatus.active,
            updatedAt,
            roleRef: { permissions, updatedAt },
            tenant: { status: TenantStatus.active },
          }),
        },
      } as never,
    );
    const request = { headers: { authorization: 'Bearer test-token' }, method: 'GET', url };
    const context = {
      getHandler: () => route.constructor.prototype.handler,
      getClass: () => route.constructor,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return guard.canActivate(context);
  }

  it('preserves single-permission metadata and authorization', async () => {
    await expect(canAccess(new SinglePermissionRoute(), ['network.view'])).resolves.toBe(true);
  });

  it('requires every permission declared on a combined route', async () => {
    await expect(canAccess(new CombinedPermissionRoute(), ['network.view'])).rejects.toThrow(
      'you do not have permission for this action',
    );
    await expect(canAccess(new CombinedPermissionRoute(), ['network.financials.view'])).rejects.toThrow(
      'you do not have permission for this action',
    );
    await expect(canAccess(new CombinedPermissionRoute(), ['network.view', 'network.financials.view'])).resolves.toBe(true);
  });

  it('redacts hierarchy references from permission-denied security logs', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await expect(
      canAccess(
        new CombinedPermissionRoute(),
        ['network.view'],
        '/v1/admin/members/network-children?parentRef=signed-parent&cursor=signed-cursor',
      ),
    ).rejects.toThrow('you do not have permission for this action');

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('GET /v1/admin/members/network-children'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('signed-parent'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('signed-cursor'));
    warn.mockRestore();
  });
});
