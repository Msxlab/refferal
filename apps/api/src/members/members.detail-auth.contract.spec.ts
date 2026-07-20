import 'reflect-metadata';
import { ForbiddenException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { PERMISSION_KEY } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { MembersAdminController } from './members.admin.controller';

describe('members fine-grained authorization contract', () => {
  it.each([
    ['leaders', 'network.view'],
    ['export', 'reports.export'],
    ['createManual', 'members.manage'],
    ['detail', 'members.view'],
    ['exportData', 'reports.export'],
    ['updateProfile', 'members.manage'],
    ['setLeader', 'members.manage'],
    ['setRole', 'settings.roles'],
    ['impersonate', 'settings.security'],
    ['impersonateEnd', 'settings.security'],
  ] as const)('%s requires %s', (method, permission) => {
    expect(Reflect.getMetadata(PERMISSION_KEY, MembersAdminController.prototype[method])).toBe(permission);
  });

  const user = (perms: string[]): RequestUser => ({
    sub: 'admin-user',
    mid: 'admin-membership',
    tid: 'tenant-1',
    role: Role.tenant_admin,
    perms,
    iat: 0,
    exp: 0,
  });

  it('authorizes bulk status and role actions against their distinct permissions', () => {
    const members = { bulk: jest.fn().mockReturnValue({ ok: true }) };
    const controller = new MembersAdminController(members as never);
    const ids = ['00000000-0000-4000-8000-000000000001'];

    expect(Reflect.getMetadata(PERMISSION_KEY, MembersAdminController.prototype.bulk)).toBeUndefined();
    expect(() => controller.bulk(user(['members.suspend']), { action: 'activate', ids })).not.toThrow();
    expect(() => controller.bulk(user(['members.suspend']), { action: 'deactivate', ids })).not.toThrow();
    expect(() => controller.bulk(user(['members.suspend']), {
      action: 'set_role',
      ids,
      role: 'tenant_staff',
    })).toThrow(ForbiddenException);
    expect(() => controller.bulk(user(['settings.roles']), {
      action: 'set_role',
      ids,
      role: 'tenant_staff',
    })).not.toThrow();
  });

  it('requires role-management permission before manual creation can elevate a member', () => {
    const members = { createManual: jest.fn().mockReturnValue({ ok: true }) };
    const controller = new MembersAdminController(members as never);
    const base = { fullName: 'New Member', email: 'new@example.com' };

    expect(() => controller.createManual(user(['members.manage']), { ...base, role: 'member' })).not.toThrow();
    expect(() => controller.createManual(user(['members.manage']), {
      ...base,
      role: 'tenant_staff',
    })).toThrow(ForbiddenException);
    expect(() => controller.createManual(user(['members.manage', 'settings.roles']), {
      ...base,
      role: 'tenant_admin',
    })).not.toThrow();
  });
});
