# Task 2A Report: Hierarchy contracts and opaque token primitives

Status: DONE

## Delivered

- Added the approved hierarchy DTO contracts for the synthetic tenant root, admin member/cluster nodes, member sponsor/self/direct/anonymous nodes, branch pages, admin context, member context, scope metadata, and capability flags.
- Kept `NetworkStatus` aligned with the Prisma database enum: `active | inactive`.
- Split anonymous member nodes into Tier 2 and Tier 3 variants. Neither variant can carry raw membership IDs, names, emails, referral codes, commissions, balances, or exact finance fields; Tier 3 is terminal and cannot carry a visible child count.
- Added a dedicated `referral-network-hierarchy:v1` token domain with strict exact-key and canonical-byte validation, unpadded base64url checks, a 2,048-character maximum, HMAC key separation, and timing-safe signature verification.
- Bound every hierarchy reference token to its kind, viewer, tenant, parent fingerprint, canonical snapshot timestamp, and a maximum 15-minute expiration window.
- Added parent, cursor, and cluster reference token creation plus a member-only creation path that stores an HMAC-derived opaque subject instead of a reversibly decodable membership UUID or name.
- Added deterministic member-reference derivation and timing-safe candidate matching so the subsequent hierarchy service can resolve only visible server-side membership candidates.
- Added database-free unit coverage for type/DTO privacy, supported statuses, context shapes, all token kinds, canonical rejection, tampering, expiration, viewer/tenant/parent/snapshot/kind replay, token size, and opaque member resolution.

## TDD evidence

RED was observed before implementation:

```text
FAIL network-hierarchy.tokens.spec.ts — TS2307: Cannot find module './network-hierarchy.tokens'
FAIL network-hierarchy.types.spec.ts — TS2307: Cannot find module './network-hierarchy.types'
```

The first GREEN attempt passed all 13 token tests and exposed a test-fixture generic error in the type suite. Correcting the fixture from the nullable focus type to `AdminNetworkNode` produced the final green result.

## Verification

Passed:

```text
Jest unit project, focused hierarchy specs
Test Suites: 2 passed, 2 total
Tests:       17 passed, 17 total
```

```text
tsc -p apps/api/tsconfig.json --noEmit
Exit code: 0
```

```text
tsc -p apps/api/tsconfig.build.json --noEmit
Exit code: 0
```

```text
Prettier check on all four implementation/spec files
All matched files use Prettier code style!
```

```text
git diff --check
Exit code: 0
```

The local Jest command shim could not locate `node` on `PATH`, so verification invoked the installed Jest and TypeScript entry points with Codex's bundled Node runtime. No dependency installation or repository configuration change was needed.

## Scope and self-review

- Created only the four Task 2A source/spec files plus this required report.
- Added no controllers, services, routes, module stubs, database access, migrations, wallet UI changes, or legacy financial endpoint changes.
- Confirmed the member token's decoded payload contains only the opaque HMAC subject, not the membership UUID or a member name.
- Confirmed canonical validation rejects reordered, extra-key, padded-base64url, tampered, expired, and overlong tokens through one generic bad-request error.

## Concerns

None blocking. Cursor and cluster subjects intentionally accept bounded unpadded-base64url values so the service task can define its canonical keyset payload without weakening the signed envelope. The member path is separate and cannot accept a caller-supplied subject.

## Commit

Commit subject: `feat: add hierarchy contracts and opaque references`
