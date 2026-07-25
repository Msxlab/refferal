# Current State

**Last reconciled:** 2026-07-22
**Workspace:** `Msxlab/refferal`
**Active branch:** `codex/earnica-referral-value-flow`
**Active pull request:** [PR #8](https://github.com/Msxlab/refferal/pull/8)
**Current phase:** Project Knowledge Vault migration; Task 2 records are being
established before the active payout release-hardening test matrix resumes.

## Read this next

1. Read the active branch handoff: [CONTINUE-HERE.md](../../CONTINUE-HERE.md).
2. For exact test/deploy evidence, read
   [verification/current-release.md](verification/current-release.md).
3. For source precedence and known documentation drift, read
   [registry.md](registry.md).
4. For blockers and non-release roadmap risks, read
   [risks-and-open-items.md](risks-and-open-items.md).

This file is a short index, not a replacement for any of those sources.

## Operational snapshot

- The referral tree product work is recorded as completed in the active handoff:
  admin Focus Cockpit/full hierarchy and privacy-bounded member Tier 1-3 tree.
- The payout dispatch checkpoint is **in progress**. Its required lifecycle is
  `processing → dispatched → settled`; full integration validation is not yet
  complete.
- Production at `https://earn.oppeinnj.com/` is **not verified**. Previous SSH
  authentication was rejected; no deployment claim is valid until the owner
  supplies working access and deployment is independently checked.
- The immediate safe work sequence is to complete the knowledge-vault migration,
  then resume the local/disposable-database payout validation sequence in the
  active handoff. Do not migrate production first.

## Current authoritative sources

| Question | Source |
| --- | --- |
| How should this session start safely? | [START-HERE.md](START-HERE.md), then [CONTINUE-HERE.md](../../CONTINUE-HERE.md) |
| What work is active and what may not be claimed? | [CONTINUE-HERE.md](../../CONTINUE-HERE.md) and [verification/current-release.md](verification/current-release.md) |
| Why was a material choice made? | `docs/knowledge/decisions/` (Task 3'te oluşturulacak) and [docs/DECISIONS.md](../DECISIONS.md) until superseded |
| Which document is current or contradictory? | [registry.md](registry.md) |
| What requires action or an owner decision? | [risks-and-open-items.md](risks-and-open-items.md) |

## Handoff rule

Do not copy long test output or change a product decision only in this file.
Update the detailed source first, then keep this page to links and a short,
date-stamped phase summary.
