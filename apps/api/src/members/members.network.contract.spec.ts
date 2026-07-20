import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_PERMISSIONS,
  defaultPermissionsForTier,
  SYSTEM_ROLES,
} from '../common/permissions';

describe('referral network permission and hierarchy contract', () => {
  const controller = readFileSync(join(__dirname, 'members.admin.controller.ts'), 'utf8');
  const hierarchyDesign = readFileSync(
    join(__dirname, '../../../../docs/superpowers/specs/2026-07-20-referral-network-hierarchy-design.md'),
    'utf8',
  );

  it('separates the financial network capability from structural network access', () => {
    expect(ALL_PERMISSIONS).toEqual(expect.arrayContaining(['network.view', 'network.financials.view']));

    for (const role of ['owner', 'admin']) {
      expect(SYSTEM_ROLES.find((seed) => seed.key === role)?.permissions).toContain(
        'network.financials.view',
      );
    }
    for (const role of ['support', 'analyst']) {
      expect(SYSTEM_ROLES.find((seed) => seed.key === role)?.permissions).not.toContain(
        'network.financials.view',
      );
    }
    expect(defaultPermissionsForTier('tenant_owner')).toContain('network.financials.view');
    expect(defaultPermissionsForTier('tenant_admin')).toContain('network.financials.view');
    expect(defaultPermissionsForTier('tenant_staff')).not.toContain('network.financials.view');
  });

  it('requires both network capabilities for legacy routes that return money', () => {
    for (const route of ['tree', 'tree-snapshot', 'leaders']) {
      expect(controller).toMatch(
        new RegExp(
          `@Roles\\(\\.\\.\\.STAFF\\)\\s+@RequirePermission\\('network\\.view', 'network\\.financials\\.view'\\)\\s+@Get\\('${route}'\\)`,
        ),
      );
    }
  });

  it('locks the approved future hierarchy caps and member privacy boundary without assuming its API exists', () => {
    expect(hierarchyDesign).toMatch(/Canvas visible node budget:\s*`250`/);
    expect(hierarchyDesign).toMatch(/Tier 4\+ kayıtları önce query'de dışlanır/);
    expect(hierarchyDesign).toMatch(/Tier 3'te `canExpand=false`/);
    expect(hierarchyDesign).toMatch(/Tier 2–3'te `displayName`, `email`, `referralCode`, raw `membershipId`/);
    expect(hierarchyDesign).toMatch(/Tier 2–3.*exact satış\/para alanı döndürmez/);
    expect(hierarchyDesign).toMatch(/Member endpoint'leri client'tan membership root kabul etmez/);
  });
});
