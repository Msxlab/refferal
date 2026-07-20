import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('network-health authorization and active-seller contract', () => {
  it('requires network.view before returning named cluster data', () => {
    const source = readFileSync(join(__dirname, 'members.admin.controller.ts'), 'utf8');
    expect(source).toMatch(/@RequirePermission\('network\.view'\)\s+@Get\('network-health'\)/);
  });

  it('counts distinct active sellers without materializing every seller id', () => {
    const source = readFileSync(join(__dirname, 'members.network-health.ts'), 'utf8');
    expect(source).toMatch(/count\(DISTINCT s\.seller_membership_id\)[\s\S]{0,320}JOIN memberships m[\s\S]{0,320}m\.status = \$\{MembershipStatus\.active\}/);
    expect(source).not.toMatch(/distinct:\s*\['sellerMembershipId'\]/);
  });

  it('returns explicit dormant scan and result completeness metadata', () => {
    const source = readFileSync(join(__dirname, 'members.network-health.ts'), 'utf8');
    expect(source).toMatch(/dormantScope:\s*{[\s\S]{0,320}totalLeaders[\s\S]{0,320}matchedDormantInScan/);
  });
});
