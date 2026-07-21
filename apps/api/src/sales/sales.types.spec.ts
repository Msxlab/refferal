import { listSalesSchema } from './sales.types';

describe('sales list summary month filter', () => {
  it('accepts a frozen YYYY-MM summary month', () => {
    expect(listSalesSchema.parse({ summaryMonth: '2026-07' }).summaryMonth).toBe('2026-07');
  });

  it('rejects a non-month summary key', () => {
    expect(() => listSalesSchema.parse({ summaryMonth: '2026-7' })).toThrow();
  });
});
