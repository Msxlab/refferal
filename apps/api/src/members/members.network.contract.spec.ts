import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_PERMISSIONS,
  defaultPermissionsForTier,
  SYSTEM_ROLES,
} from "../common/permissions";

describe("referral network permission and hierarchy contract", () => {
  const controller = readFileSync(
    join(__dirname, "members.admin.controller.ts"),
    "utf8",
  );
  const hierarchyDesign = readFileSync(
    join(
      __dirname,
      "../../../../docs/superpowers/specs/2026-07-20-referral-network-hierarchy-design.md",
    ),
    "utf8",
  );

  it("separates the financial network capability from structural network access", () => {
    expect(ALL_PERMISSIONS).toEqual(
      expect.arrayContaining(["network.view", "network.financials.view"]),
    );

    for (const role of ["owner", "admin"]) {
      expect(
        SYSTEM_ROLES.find((seed) => seed.key === role)?.permissions,
      ).toContain("network.financials.view");
    }
    for (const role of ["support", "analyst"]) {
      expect(
        SYSTEM_ROLES.find((seed) => seed.key === role)?.permissions,
      ).not.toContain("network.financials.view");
    }
    expect(defaultPermissionsForTier("tenant_owner")).toContain(
      "network.financials.view",
    );
    expect(defaultPermissionsForTier("tenant_admin")).toContain(
      "network.financials.view",
    );
    expect(defaultPermissionsForTier("tenant_staff")).not.toContain(
      "network.financials.view",
    );
  });

  it("requires both network capabilities for legacy routes that return money", () => {
    for (const route of ["tree", "tree-snapshot", "leaders"]) {
      expect(controller).toMatch(
        new RegExp(
          `@Roles\\(\\.\\.\\.STAFF\\)\\s+@RequirePermission\\(["']network\\.view["'], ["']network\\.financials\\.view["']\\)\\s+@Get\\(["']${route}["']\\)`,
        ),
      );
    }
  });

  it("declares every structural hierarchy route before the dynamic member route", () => {
    const dynamicRoute = controller.search(/@Get\(["']:id["']\)/);

    expect(dynamicRoute).toBeGreaterThan(0);
    for (const route of [
      "network-context",
      "network-search",
      "network-children",
      "network-cluster-children",
      "network-list",
    ]) {
      const routePosition = controller.search(new RegExp(`\(["']${route}["']\)`));
      expect(routePosition).toBeGreaterThan(0);
      expect(routePosition).toBeLessThan(dynamicRoute);
    }
  });

  it("keeps hierarchy search body-only, bounded, and absent from GET query schemas", () => {
    expect(controller).toMatch(
      /const networkSearchSchema = z\.object\(\{[\s\S]*query: z\.string\(\)\.trim\(\)\.min\(2\)\.max\(120\)/,
    );
    expect(controller).toMatch(
      /@Post\(["']network-search["']\)[\s\S]*@Body\(new ZodValidationPipe\(networkSearchSchema\)\)/,
    );
    expect(controller).not.toMatch(/@Get\(["']network-search["']\)/);
    const searchMethod = controller.slice(
      controller.indexOf("networkSearch("),
      controller.search(/@Get\(["']network-children["']\)/),
    );
    expect(searchMethod).toContain(
      "@Body(new ZodValidationPipe(networkSearchSchema))",
    );
    expect(searchMethod).not.toContain("@Query(");
  });

  it("validates hierarchy scope, focus, depth, canonical snapshots, and bounded opaque references", () => {
    expect(controller).toMatch(
      /depth: z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(5\)\.default\(3\)/,
    );
    expect(controller).toMatch(/scope === ["']focused["'].*focusId/s);
    expect(controller).toMatch(/scope === ["']full["'].*focusId/s);
    expect(controller).toMatch(/new Date\(value\)\.toISOString\(\) === value/);
    expect(controller).toMatch(/\.max\(HIERARCHY_TOKEN_MAX_LENGTH\)/);
  });

  it("guards structural hierarchy independently and derives optional capabilities independently", () => {
    for (const route of [
      "network-context",
      "network-search",
      "network-children",
      "network-cluster-children",
      "network-list",
    ]) {
      expect(controller).toMatch(
        new RegExp(
          `@Roles\\(\\.\\.\\.STAFF\\)\\s+@RequirePermission\\(["']network\\.view["']\\)[\\s\\S]{0,80}\\(["']${route}["']\\)`,
        ),
      );
    }
    expect(controller).toMatch(
      /hasEffectivePermission\(user, ["']network\.financials\.view["']\)/,
    );
    expect(controller).toMatch(/hasEffectivePermission\(user, ["']members\.view["']\)/);
  });

  it("locks the approved future hierarchy caps and member privacy boundary without assuming its API exists", () => {
    expect(hierarchyDesign).toMatch(/Canvas visible node budget:\s*`250`/);
    expect(hierarchyDesign).toMatch(
      /Tier 4\+ kayıtları önce query'de dışlanır/,
    );
    expect(hierarchyDesign).toMatch(/Tier 3'te `canExpand=false`/);
    expect(hierarchyDesign).toMatch(
      /Tier 2–3'te `displayName`, `email`, `referralCode`, raw `membershipId`/,
    );
    expect(hierarchyDesign).toMatch(
      /Tier 2–3.*exact satış\/para alanı döndürmez/,
    );
    expect(hierarchyDesign).toMatch(
      /Member endpoint'leri client'tan membership root kabul etmez/,
    );
  });
});
