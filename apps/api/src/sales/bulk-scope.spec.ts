import { bulkScopeFingerprint, normalizeBulkScope } from './bulk-scope';

describe('bulk sales scope normalization', () => {
  it('keeps the frozen summary month in all-results scope and its fingerprint', () => {
    const july = normalizeBulkScope({
      mode: 'all-results',
      filters: { status: 'approved', summaryMonth: '2026-07', sort: 'saleDate', dir: 'desc', page: 1, pageSize: 25 },
    });
    const august = normalizeBulkScope({
      mode: 'all-results',
      filters: { status: 'approved', summaryMonth: '2026-08', sort: 'saleDate', dir: 'desc', page: 1, pageSize: 25 },
    });

    expect(july).toEqual({
      mode: 'all-results',
      filters: { status: 'approved', summaryMonth: '2026-07' },
    });
    expect(bulkScopeFingerprint(july)).not.toBe(bulkScopeFingerprint(august));
  });
});
