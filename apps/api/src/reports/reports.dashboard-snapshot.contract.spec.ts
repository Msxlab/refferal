import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('ReportsService dashboard snapshot contract', () => {
  it('reads monthly sales and commissions in one repeatable-read transaction', () => {
    const source = readFileSync(join(__dirname, 'reports.service.ts'), 'utf8');
    const dashboard = source.slice(source.indexOf('async dashboard('), source.indexOf('/**', source.indexOf('async dashboard(') + 1));

    expect(dashboard).toContain('this.prisma.sale.aggregate');
    expect(dashboard).toContain('this.prisma.monthlySummary.aggregate');
    expect(dashboard).toContain('Prisma.TransactionIsolationLevel.RepeatableRead');
    expect(dashboard).not.toContain('const commissionAgg = await this.prisma.monthlySummary.aggregate');
  });
});
