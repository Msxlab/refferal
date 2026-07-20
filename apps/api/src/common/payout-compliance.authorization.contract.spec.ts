import 'reflect-metadata';
import { AdminChecksController } from '../checks/checks.controller';
import { FraudController } from '../fraud/fraud.controller';
import { PERMISSION_KEY } from '../auth/auth.guard';
import { AdminKycController } from '../kyc/kyc.controller';
import { AdminPayoutsController } from '../payouts/payouts.controller';
import { ReportsController } from '../reports/reports.controller';

describe('payout and compliance fine-grained authorization contract', () => {
  it.each([
    ['fraud.list', FraudController.prototype.list, 'compliance.view'],
    ['fraud.scan', FraudController.prototype.scan, 'compliance.review'],
    ['fraud.decide', FraudController.prototype.decide, 'compliance.review'],
    ['checks.list', AdminChecksController.prototype.list, 'payouts.view'],
    ['checks.pdf', AdminChecksController.prototype.pdf, 'payouts.view'],
    ['checks.run', AdminChecksController.prototype.run, 'payouts.process'],
    ['checks.markMailed', AdminChecksController.prototype.markMailed, 'payouts.process'],
    ['kyc.list', AdminKycController.prototype.list, 'compliance.view'],
    ['kyc.decide', AdminKycController.prototype.decide, 'compliance.review'],
    ['payouts.ach', AdminPayoutsController.prototype.ach, 'payouts.export'],
    ['payouts.reconcile', AdminPayoutsController.prototype.reconcile, 'payouts.process'],
    ['payouts.batches', AdminPayoutsController.prototype.batches, 'payouts.view'],
    ['payouts.approveBatch', AdminPayoutsController.prototype.approveBatch, 'payouts.process'],
    ['payouts.rejectBatch', AdminPayoutsController.prototype.rejectBatch, 'payouts.process'],
    ['payouts.detail', AdminPayoutsController.prototype.detail, 'payouts.view'],
    ['payouts.decide', AdminPayoutsController.prototype.decide, 'payouts.process'],
    ['payouts.retry', AdminPayoutsController.prototype.retry, 'payouts.process'],
    ['reports.clawbacks', ReportsController.prototype.clawbacks, 'reports.view'],
    ['reports.tax1099', ReportsController.prototype.tax1099, 'reports.view'],
    ['reports.tax1099Csv', ReportsController.prototype.tax1099Csv, 'reports.export'],
  ] as const)('%s requires its fine permission', (_name, handler, permission) => {
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(permission);
  });
});
