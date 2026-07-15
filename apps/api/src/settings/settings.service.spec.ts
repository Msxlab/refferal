import { SettingsService } from './settings.service';

describe('SettingsService plan bonus delegation', () => {
  const actor = {
    tenantId: '10000000-0000-0000-0000-000000000001',
    userId: '20000000-0000-0000-0000-000000000001',
  };
  const bonus = { fastStartBps: 700, fastStartDays: 30, matchingBps: 250 };

  function serviceWith(plans: {
    getPlanBonus: jest.Mock;
    createBonusVersion: jest.Mock;
  }): SettingsService {
    const Constructor = SettingsService as unknown as new (prisma: unknown, plans: unknown) => SettingsService;
    return new Constructor({}, plans);
  }

  it('delegates reads to the plan version owner', async () => {
    const expected = { planId: 'plan-1', planName: 'Current', ...bonus };
    const plans = {
      getPlanBonus: jest.fn(async () => expected),
      createBonusVersion: jest.fn(),
    };

    await expect(serviceWith(plans).getPlanBonus(actor.tenantId)).resolves.toEqual(expected);
    expect(plans.getPlanBonus).toHaveBeenCalledWith(actor.tenantId);
  });

  it('delegates bonus changes to immutable version creation', async () => {
    const expected = { planId: 'plan-2', planName: 'Current', version: 2, ...bonus };
    const plans = {
      getPlanBonus: jest.fn(),
      createBonusVersion: jest.fn(async () => expected),
    };

    await expect(serviceWith(plans).updatePlanBonus(actor, bonus)).resolves.toEqual(expected);
    expect(plans.createBonusVersion).toHaveBeenCalledWith(actor, bonus);
  });
});
