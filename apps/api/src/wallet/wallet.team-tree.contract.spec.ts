import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  memberTreeChildrenQuerySchema,
  memberTreeDirectSearchSchema,
} from './wallet.types';

describe('legacy wallet team privacy contract', () => {
  const controller = readFileSync(join(__dirname, 'wallet.controller.ts'), 'utf8');
  const service = readFileSync(join(__dirname, 'wallet.service.ts'), 'utf8');
  const moduleSource = readFileSync(join(__dirname, 'wallet.module.ts'), 'utf8');
  const types = readFileSync(join(__dirname, 'wallet.types.ts'), 'utf8');

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

  it('registers member tree routes statically before legacy team and derives scope only from the session', () => {
    const tree = controller.indexOf("@Get('team/tree')");
    const children = controller.indexOf("@Get('team/tree/children')");
    const search = controller.indexOf("@Post('team/tree/direct-search')");
    const legacyTeam = controller.indexOf("@Get('team')");

    expect(tree).toBeGreaterThanOrEqual(0);
    expect(children).toBeGreaterThan(tree);
    expect(search).toBeGreaterThan(children);
    expect(legacyTeam).toBeGreaterThan(search);
    expect(controller).toMatch(
      /teamTree\(@CurrentUser\(\) user: RequestUser\)\s*{\s*return this\.wallet\.teamTree\(this\.actor\(user\), user\.mid as string\);/,
    );
    expect(controller).toMatch(
      /teamTreeChildren\([\s\S]*@Query\(new ZodValidationPipe\(memberTreeChildrenQuerySchema\)\)/,
    );
    expect(controller).toMatch(
      /teamTreeDirectSearch\([\s\S]*@Body\(new ZodValidationPipe\(memberTreeDirectSearchSchema\)\)/,
    );
    expect(controller).toMatch(
      /@HttpCode\(200\)\s+@Post\('team\/tree\/direct-search'\)/,
    );
    expect(controller).toMatch(
      /private actor\(user: RequestUser\): ActorContext\s*{\s*return \{ userId: user\.sub, tenantId: user\.tid as string \};/,
    );
  });

  it('keeps children and body-only direct search schemas strict and wires the hierarchy module', () => {
    expect(types).toMatch(/memberTreeChildrenQuerySchema[\s\S]*\.strict\(\)/);
    expect(types).toMatch(/memberTreeDirectSearchSchema[\s\S]*\.strict\(\)/);
    expect(types).toMatch(/parentRef: opaqueMemberHierarchyReference/);
    expect(types).toMatch(/snapshotAt: canonicalHierarchySnapshot/);
    expect(types).toMatch(/query: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(120\)/);
    expect(service).toMatch(/return this\.hierarchy\.memberContext\(actor, \{ rootMembershipId \}\)/);
    expect(service).toMatch(/return this\.hierarchy\.memberChildren\(actor, \{ rootMembershipId, \.\.\.query \}\)/);
    expect(service).toMatch(/return this\.hierarchy\.memberDirectSearch\(actor, \{ rootMembershipId, \.\.\.input \}\)/);
    expect(moduleSource).toMatch(/imports: \[PayoutComplianceModule, NetworkHierarchyModule\]/);
  });

  it('rejects caller-controlled tree scope fields from strict public schemas', () => {
    const opaque = `A.${'A'.repeat(43)}`;
    const snapshotAt = '2026-07-20T12:00:00.000Z';

    expect(
      memberTreeChildrenQuerySchema.safeParse({
        parentRef: opaque,
        snapshotAt,
        rootMembershipId: 'caller-controlled',
      }).success,
    ).toBe(false);
    expect(
      memberTreeDirectSearchSchema.safeParse({
        query: 'Direct',
        cursor: opaque,
        focusId: 'caller-controlled',
      }).success,
    ).toBe(false);
  });
});
