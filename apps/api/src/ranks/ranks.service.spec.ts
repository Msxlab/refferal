import { LedgerStatus } from '@prisma/client';
import { RanksService } from './ranks.service';

describe('RanksService vested earnings', () => {
  function clientWithEarnings(status: LedgerStatus) {
    return {
      membership: {
        findFirst: jest.fn().mockResolvedValue({ path: 'tenant.member' }),
      },
      ledgerEntry: {
        aggregate: jest.fn(({ where }: { where: { status: { in: LedgerStatus[] } } }) => ({
          _sum: {
            amountCents: where.status.in.includes(status) ? 100_000n : 0n,
          },
        })),
      },
      rankTier: {
        findMany: jest.fn().mockResolvedValue([
          {
            name: 'Silver',
            sortOrder: 1,
            minTeam: 0,
            minEarningsCents: 100_000n,
            overrideBps: 250,
          },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ c: 0n }]),
    };
  }

  it('keeps the same tier override when vested earnings move from payable to processing', async () => {
    const ranks = new RanksService(null as never);
    const payableClient = clientWithEarnings(LedgerStatus.payable);
    const processingClient = clientWithEarnings(LedgerStatus.processing);

    await expect(ranks.overrideBpsFor(payableClient as never, 'tenant-1', 'member-1')).resolves.toBe(250);
    await expect(ranks.overrideBpsFor(processingClient as never, 'tenant-1', 'member-1')).resolves.toBe(250);

    expect(processingClient.ledgerEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { in: [LedgerStatus.payable, LedgerStatus.processing, LedgerStatus.paid] },
      }),
    }));
  });
});
