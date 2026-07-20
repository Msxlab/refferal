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

## Review follow-up: branded DTO boundary and snapshot expiry

Status: ADDRESSED

Two Important review findings were resolved in a follow-up commit:

- Added unique-symbol `OpaqueMemberNodeRef` and `AnonymousMemberInitials` brands. Tier 2 and Tier 3 `nodeRef`, `parentRef`, and `initials` fields no longer accept a plain TypeScript `string`; direct-member `nodeRef` uses the same opaque brand so it can safely parent Tier 2 nodes.
- Added public type guards and parsers. Opaque refs must be a bounded, structurally canonical two-section base64url token with a 32-byte signature; UUIDs, names, emails, and noncanonical base64url are rejected. Anonymous initials must be NFC-normalized and exactly two uppercase Unicode letters.
- Changed `createHierarchyMemberReferenceToken` to return `OpaqueMemberNodeRef`, giving the service task a safe construction path without assertions.
- Added exported `NetworkSnapshotExpiredException`, an HTTP 409 response carrying `code: 'NETWORK_SNAPSHOT_EXPIRED'`.
- Moved expiry handling after signature verification, exact canonical payload validation, and complete kind/viewer/tenant/parent/snapshot binding validation. Tampered or replayed tokens remain the generic `BadRequestException` path even when checked after their nominal expiry.

The follow-up expiry behavior supersedes the original report statement that all expired tokens use the generic bad-request error. Only a cryptographically valid, canonically encoded, correctly bound expired token receives the dedicated 409.

### Follow-up TDD evidence

RED was observed before each production change:

```text
types spec: missing brand/parser exports and plain string remained assignable to all eight checked privacy fields
tokens spec: missing NETWORK_SNAPSHOT_EXPIRED and NetworkSnapshotExpiredException exports
types edge-case spec: noncanonical one-character base64url payload was incorrectly accepted
```

GREEN after implementation and self-review:

```text
Jest unit project, focused hierarchy specs
Test Suites: 2 passed, 2 total
Tests:       20 passed, 20 total
```

```text
tsc -p apps/api/tsconfig.json --noEmit
Exit code: 0

tsc -p apps/api/tsconfig.build.json --noEmit
Exit code: 0

Prettier check
All matched files use Prettier code style!

git diff --check
Exit code: 0
```

### Follow-up scope and concerns

- Modified only the Task 2A type/token implementation and focused specs, plus this report.
- Added no routes, controllers, services, modules, database access, or UI changes.
- No blocking concerns remain.

Follow-up commit subject: `fix: harden hierarchy privacy and expiry contracts`
