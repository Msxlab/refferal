## Task 2A: Define hierarchy contracts and opaque token primitives

**Files:**

- Create: `apps/api/src/members/network-hierarchy.types.ts`
- Create: `apps/api/src/members/network-hierarchy.tokens.ts`
- Create: `apps/api/src/members/network-hierarchy.tokens.spec.ts`
- Create: `apps/api/src/members/network-hierarchy.types.spec.ts`

This is the first, isolated half of plan Task 2. Do not add controllers, service methods, or routes in this task.

1. Define the approved structural TypeScript contracts from section 9 of `docs/superpowers/specs/2026-07-20-referral-network-hierarchy-design.md`: synthetic tenant root, admin member/cluster union, member sponsor/self/direct/anonymous unions, branch page, admin context, member context, and capability/scope fields.
2. Preserve the actual database status domain (`active | inactive`) rather than inventing unsupported pending/suspended values. Admin anonymous/ref distinctions must make identity and exact-finance fields impossible on Tier 2–3 in TypeScript.
3. Implement strict versioned HMAC token primitives for hierarchy parent/cursor/cluster/member references using the hardened canonical validation pattern in `apps/api/src/sales/bulk-scope.ts` and `authConfig.accessSecret()`. Tokens must have a dedicated hierarchy domain, canonical payload validation, maximum length, timing-safe signature check, tenant/viewer binding, snapshot binding, and expiration.
4. Member node references must not encode a raw membership UUID or name in a reversibly decodable payload. Provide an HMAC-derived opaque reference helper suitable for resolving a visible member server-side in the next task.
5. Add meaningful database-free unit tests for canonical token rejection, tamper/expiry/viewer/tenant/snapshot binding, and type/DTO privacy shape. Use the existing local Jest project conventions and keep the new code reusable by the service task.

**Non-goals:** Do not add hierarchy endpoints or fake service stubs; do not modify member wallet UI; do not change legacy financial endpoints.
