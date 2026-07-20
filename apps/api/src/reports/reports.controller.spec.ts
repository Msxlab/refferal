import { Role } from '@prisma/client';
import { ReportsController } from './reports.controller';
import type { ReportsService, TodoAccess } from './reports.service';

describe('ReportsController todo permissions', () => {
  function controller() {
    const todo = jest.fn((_tenantId: string, access: TodoAccess) => access);
    return {
      todo,
      reports: new ReportsController({ todo } as unknown as ReportsService),
    };
  }

  it('keeps owner and platform act-as todo access when compact tokens omit perms', () => {
    const { reports, todo } = controller();

    reports.todo({ tid: 'tenant-1', role: Role.tenant_owner } as never);

    expect(todo).toHaveBeenCalledWith('tenant-1', {
      salesApproval: true,
      payoutProcessing: true,
      complianceReview: true,
    });
  });

  it('does not advertise admin-only sales approval to staff with fine permissions', () => {
    const { reports, todo } = controller();

    reports.todo({
      tid: 'tenant-1',
      role: Role.tenant_staff,
      perms: ['sales.approve', 'sales.view'],
    } as never);

    expect(todo).toHaveBeenCalledWith('tenant-1', {
      salesApproval: false,
      payoutProcessing: false,
      complianceReview: false,
    });
  });

  it('advertises admin-only buckets to admins with the matching fine permissions', () => {
    const { reports, todo } = controller();

    reports.todo({
      tid: 'tenant-1',
      role: Role.tenant_admin,
      perms: [
        'sales.approve',
        'sales.view',
        'payouts.process',
        'payouts.view',
        'compliance.view',
        'compliance.review',
        'members.view',
      ],
    } as never);

    expect(todo).toHaveBeenCalledWith('tenant-1', {
      salesApproval: true,
      payoutProcessing: true,
      complianceReview: true,
    });
  });

  it('requires both an action permission and the destination view permission', () => {
    const { reports, todo } = controller();

    reports.todo({
      tid: 'tenant-1',
      role: Role.tenant_staff,
      perms: ['sales.approve', 'compliance.review'],
    } as never);

    expect(todo).toHaveBeenCalledWith('tenant-1', {
      salesApproval: false,
      payoutProcessing: false,
      complianceReview: false,
    });
  });

  it('requires payouts.view before advertising the fraud review destination', () => {
    const { reports, todo } = controller();

    reports.todo({
      tid: 'tenant-1',
      role: Role.tenant_admin,
      perms: ['compliance.review', 'members.view'],
    } as never);

    expect(todo).toHaveBeenCalledWith('tenant-1', {
      salesApproval: false,
      payoutProcessing: false,
      complianceReview: false,
    });
  });

  it('requires compliance.view before advertising review work', () => {
    const { reports, todo } = controller();

    reports.todo({
      tid: 'tenant-1',
      role: Role.tenant_admin,
      perms: ['compliance.review', 'payouts.view'],
    } as never);

    expect(todo).toHaveBeenCalledWith('tenant-1', {
      salesApproval: false,
      payoutProcessing: false,
      complianceReview: false,
    });
  });

  it('does not return financial-control links to staff roles blocked by those routes', () => {
    const { reports, todo } = controller();

    reports.todo({
      tid: 'tenant-1',
      role: Role.tenant_staff,
      perms: ['payouts.process', 'compliance.review'],
    } as never);

    expect(todo).toHaveBeenCalledWith('tenant-1', {
      salesApproval: false,
      payoutProcessing: false,
      complianceReview: false,
    });
  });
});
