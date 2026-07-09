import { SchedulerService } from './scheduler.service';

describe('jobHealthWithStaleness (unit)', () => {
  it('flags a job whose lastRun exceeds its FRESHNESS_MS', () => {
    const svc = Object.create(SchedulerService.prototype) as SchedulerService;
    // @ts-expect-error private map access for the test
    svc.lastRun = new Map([['mature-commissions', { at: new Date(Date.now() - 60 * 60_000), ok: true }]]);
    const rows = svc.jobHealthWithStaleness();
    const job = rows.find((r) => r.name === 'mature-commissions')!;
    expect(job.stale).toBe(true);
  });

  it('does not flag a fresh job', () => {
    const svc = Object.create(SchedulerService.prototype) as SchedulerService;
    // @ts-expect-error private map access for the test
    svc.lastRun = new Map([['mature-commissions', { at: new Date(), ok: true }]]);
    expect(svc.jobHealthWithStaleness()[0].stale).toBe(false);
  });
});
