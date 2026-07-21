import { ArgumentsHost } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { captureError } from '../observability/sentry';
import { SentryExceptionFilter } from './sentry-exceptions.filter';

jest.mock('../observability/sentry', () => ({ captureError: jest.fn() }));

describe('SentryExceptionFilter hierarchy URL redaction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(BaseExceptionFilter.prototype, 'catch').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('captures only the hierarchy pathname for unexpected errors', () => {
    const request = {
      method: 'GET',
      url: '/v1/admin/members/network-children?parentRef=signed-parent&cursor=signed-cursor',
      user: { sub: 'user-1', tid: 'tenant-1' },
    };
    const host = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ArgumentsHost;

    new SentryExceptionFilter().catch(new Error('unexpected'), host);

    expect(captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        method: 'GET',
        url: '/v1/admin/members/network-children',
        userId: 'user-1',
        tenantId: 'tenant-1',
      }),
    );
  });
});
