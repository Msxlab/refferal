import 'reflect-metadata';
import { PERMISSION_KEY } from '../auth/auth.guard';
import { SalesController } from './sales.controller';

describe('sales fine-grained authorization contract', () => {
  it.each([
    ['summary', 'sales.view'],
    ['export', 'sales.export'],
    ['remove', 'sales.void'],
  ] as const)('%s requires %s', (method, permission) => {
    expect(Reflect.getMetadata(PERMISSION_KEY, SalesController.prototype[method])).toBe(permission);
  });
});
