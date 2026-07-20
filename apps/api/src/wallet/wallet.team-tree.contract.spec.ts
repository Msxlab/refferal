import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('legacy wallet team privacy contract', () => {
  const controller = readFileSync(join(__dirname, 'wallet.controller.ts'), 'utf8');
  const service = readFileSync(join(__dirname, 'wallet.service.ts'), 'utf8');

  it('keeps the legacy team endpoint bound to the signed-in membership', () => {
    expect(controller).toMatch(
      /@Get\('team'\)\s+team\(@CurrentUser\(\) user: RequestUser\)\s*{\s*return this\.wallet\.team\(user\.mid as string, user\.tid as string\);/,
    );
    expect(service).toMatch(/async team\(membershipId: string, tenantId: string\)/);
    expect(service).toMatch(/this\.tenantContext\.assertMembership\(membershipId\)/);
  });

  it('keeps the existing aggregate-only team query depth-bounded', () => {
    const teamBody = service.slice(service.indexOf('async team('), service.indexOf('async recruits('));

    expect(teamBody).toMatch(/SELECT depth,/);
    expect(teamBody).toMatch(/count\(\*\)/);
    expect(teamBody).toMatch(/AND depth <= \$\{maxDepth\}/);
    expect(teamBody).not.toMatch(/fullName|email|referralCode/i);
  });
});
