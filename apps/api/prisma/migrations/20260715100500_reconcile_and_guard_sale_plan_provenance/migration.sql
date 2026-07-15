CREATE OR REPLACE FUNCTION reconcile_sale_commission_plan_provenance() RETURNS integer AS $$
DECLARE
  unpinned_count integer := 0;
  pinned_count integer := 0;
BEGIN

-- Lock sales first: engine transactions already write/lock sales before ledger work. Waiting
-- here drains in-flight writers and blocks new ones without creating a sale<->ledger deadlock.
LOCK TABLE "sales" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "ledger_entries" IN SHARE MODE;
LOCK TABLE "commission_plans" IN SHARE MODE;
LOCK TABLE "commission_plan_levels" IN SHARE MODE;

CREATE TEMPORARY TABLE "provenance_candidates" ON COMMIT DROP AS
WITH evidence AS (
  SELECT
    sale.id AS sale_id,
    sale.tenant_id,
    sale.sale_date,
    sale.amount_cents,
    MIN(entry.created_at) AS evidence_at
  FROM sales sale
  JOIN memberships seller
    ON seller.id = sale.seller_membership_id
  JOIN ledger_entries entry
    ON entry.sale_id = sale.id
   AND entry.type = 'commission'
  LEFT JOIN memberships beneficiary
    ON beneficiary.id = entry.beneficiary_membership_id
  WHERE sale.status IN ('approved', 'void')
    AND sale.approved_at IS NOT NULL
  GROUP BY sale.id, sale.tenant_id, sale.sale_date, sale.amount_cents, seller.tenant_id
  HAVING COUNT(*) > 0
     AND MIN(entry.created_at) = MAX(entry.created_at)
     AND seller.tenant_id IS NOT DISTINCT FROM sale.tenant_id
     AND BOOL_AND(entry.tenant_id IS NOT DISTINCT FROM sale.tenant_id) IS TRUE
     AND BOOL_AND(beneficiary.tenant_id IS NOT DISTINCT FROM sale.tenant_id) IS TRUE
),
trusted_candidates AS (
  SELECT evidence.sale_id, evidence.tenant_id, plan.id AS plan_id
  FROM evidence
  JOIN commission_plans plan
    ON plan.tenant_id = evidence.tenant_id
   AND plan.finalized = TRUE
   AND plan.depth > 0
   AND plan.created_at < evidence.evidence_at
   AND plan.updated_at < evidence.evidence_at
   AND plan.effective_from <= evidence.sale_date
  WHERE NOT EXISTS (
      SELECT 1
      FROM commission_plans later_higher
      WHERE later_higher.tenant_id = plan.tenant_id
        AND later_higher.finalized = TRUE
        AND later_higher.created_at >= evidence.evidence_at
        AND later_higher.effective_from <= evidence.sale_date
        AND later_higher.effective_from > plan.effective_from
    )
    AND (
      SELECT COUNT(*)
      FROM commission_plan_levels snapshot_level
      WHERE snapshot_level.plan_id = plan.id
    ) = plan.depth
    AND NOT EXISTS (
      SELECT 1
      FROM commission_plan_levels snapshot_level
      WHERE snapshot_level.plan_id = plan.id
        AND (
          snapshot_level.level < 0
          OR snapshot_level.level >= plan.depth
          OR snapshot_level.created_at >= evidence.evidence_at
          OR snapshot_level.updated_at >= evidence.evidence_at
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_entries entry
      WHERE entry.sale_id = evidence.sale_id
        AND entry.type = 'commission'
        AND (
          entry.tenant_id IS DISTINCT FROM evidence.tenant_id
          OR entry.level < 0
          OR entry.level >= plan.depth
          OR entry.amount_cents <= 0
          OR FLOOR((evidence.amount_cents::numeric * entry.rate_bps_used::numeric) / 10000)
             IS DISTINCT FROM entry.amount_cents::numeric
          OR NOT EXISTS (
            SELECT 1
            FROM commission_plan_levels matched_level
            WHERE matched_level.plan_id = plan.id
              AND matched_level.level = entry.level
              AND matched_level.rate_bps = entry.rate_bps_used
              AND matched_level.created_at < evidence.evidence_at
              AND matched_level.updated_at < evidence.evidence_at
          )
        )
    )
),
distinct_candidates AS (
  SELECT DISTINCT sale_id, tenant_id, plan_id
  FROM trusted_candidates
)
SELECT
  candidate.sale_id,
  candidate.tenant_id,
  candidate.plan_id,
  COUNT(*) OVER (PARTITION BY candidate.sale_id, candidate.tenant_id) AS candidate_count
FROM distinct_candidates candidate;

-- A timestamp winner is not identity proof under MVCC. Undo any earlier inferred pin when
-- two complete/stable plan identities explain the exact same persisted commission signature.
UPDATE sales sale
SET commission_plan_id = NULL
FROM (
  SELECT DISTINCT sale_id, tenant_id
  FROM provenance_candidates
  WHERE candidate_count > 1
) ambiguous
WHERE sale.id = ambiguous.sale_id
  AND sale.tenant_id = ambiguous.tenant_id
  AND sale.commission_plan_id IS NOT NULL;
GET DIAGNOSTICS unpinned_count = ROW_COUNT;

-- Only a single exact plan identity is safe to infer. Existing explicit pins are preserved
-- unless the evidence above proved them ambiguous.
UPDATE sales sale
SET commission_plan_id = candidate.plan_id
FROM provenance_candidates candidate
WHERE candidate.candidate_count = 1
  AND sale.id = candidate.sale_id
  AND sale.tenant_id = candidate.tenant_id
  AND sale.commission_plan_id IS NULL;
GET DIAGNOSTICS pinned_count = ROW_COUNT;

RETURN unpinned_count + pinned_count;
END;
$$ LANGUAGE plpgsql;

SELECT reconcile_sale_commission_plan_provenance();
