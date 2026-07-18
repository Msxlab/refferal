-- Deployment precondition: plan/level history before the immutability migration is complete
-- and its timestamps are trusted. Missing or ambiguous evidence deliberately remains NULL.
-- Stabilize every relation used for inference; the lock order matches the later reconciler.
LOCK TABLE "sales" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE "ledger_entries" IN SHARE MODE;
LOCK TABLE "commission_plans" IN SHARE MODE;
LOCK TABLE "commission_plan_levels" IN SHARE MODE;

WITH evidence AS (
  SELECT
    s.id AS sale_id,
    s.tenant_id,
    s.sale_date,
    s.amount_cents,
    MIN(le.created_at) AS evidence_at
  FROM sales s
  JOIN memberships seller
    ON seller.id = s.seller_membership_id
  JOIN ledger_entries le
    ON le.sale_id = s.id
   AND le.type = 'commission'
  LEFT JOIN memberships beneficiary
    ON beneficiary.id = le.beneficiary_membership_id
  WHERE s.commission_plan_id IS NULL
    AND s.status IN ('approved', 'void')
    AND s.approved_at IS NOT NULL
  GROUP BY s.id, s.tenant_id, s.sale_date, s.amount_cents, seller.tenant_id
  HAVING COUNT(*) > 0
     AND MIN(le.created_at) = MAX(le.created_at)
     AND seller.tenant_id IS NOT DISTINCT FROM s.tenant_id
     AND BOOL_AND(le.tenant_id IS NOT DISTINCT FROM s.tenant_id) IS TRUE
     AND BOOL_AND(beneficiary.tenant_id IS NOT DISTINCT FROM s.tenant_id) IS TRUE
),
eligible_plans AS (
  SELECT
    e.sale_id,
    e.tenant_id,
    e.sale_date,
    e.amount_cents,
    e.evidence_at,
    p.id AS plan_id,
    p.effective_from,
    p.updated_at AS plan_updated_at,
    p.depth
  FROM evidence e
  JOIN commission_plans p
    ON p.tenant_id = e.tenant_id
   AND p.created_at < e.evidence_at
   AND p.effective_from <= e.sale_date
),
historical_winners AS (
  -- Select the plan the historical engine could have selected before inspecting
  -- completeness or signature. A lower exact plan is never a safe fallback.
  SELECT ranked.sale_id, ranked.tenant_id, ranked.plan_id
  FROM (
    SELECT
      candidate.sale_id,
      candidate.tenant_id,
      candidate.plan_id,
      ROW_NUMBER() OVER (
        PARTITION BY candidate.sale_id, candidate.tenant_id
        ORDER BY candidate.effective_from DESC, candidate.plan_id DESC
      ) AS engine_rank
    FROM eligible_plans candidate
  ) ranked
  WHERE ranked.engine_rank = 1
),
trusted_candidates AS (
  SELECT
    candidate.sale_id,
    candidate.tenant_id,
    candidate.plan_id,
    candidate.sale_date,
    candidate.evidence_at,
    candidate.effective_from
  FROM eligible_plans candidate
  WHERE candidate.depth > 0
    AND candidate.plan_updated_at < candidate.evidence_at
    AND (
      SELECT COUNT(*)
      FROM commission_plan_levels snapshot_count
      WHERE snapshot_count.plan_id = candidate.plan_id
    ) = candidate.depth
    AND NOT EXISTS (
      SELECT 1
      FROM commission_plan_levels snapshot_level
      WHERE snapshot_level.plan_id = candidate.plan_id
        AND (
          snapshot_level.level < 0
          OR snapshot_level.level >= candidate.depth
          OR snapshot_level.created_at >= candidate.evidence_at
          OR snapshot_level.updated_at >= candidate.evidence_at
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_entries le
      WHERE le.sale_id = candidate.sale_id
        AND le.type = 'commission'
        AND (
          le.tenant_id IS DISTINCT FROM candidate.tenant_id
          OR le.level < 0
          OR le.level >= candidate.depth
          OR le.amount_cents <= 0
          OR FLOOR((candidate.amount_cents::numeric * le.rate_bps_used::numeric) / 10000)
             IS DISTINCT FROM le.amount_cents::numeric
          OR NOT EXISTS (
            SELECT 1
            FROM commission_plan_levels matched_level
            WHERE matched_level.plan_id = candidate.plan_id
              AND matched_level.level = le.level
              AND matched_level.rate_bps = le.rate_bps_used
              AND matched_level.created_at < candidate.evidence_at
              AND matched_level.updated_at < candidate.evidence_at
          )
        )
    )
),
distinct_candidates AS (
  SELECT DISTINCT sale_id, tenant_id, plan_id, sale_date, evidence_at, effective_from
  FROM trusted_candidates
),
candidate_counts AS (
  SELECT sale_id, tenant_id, COUNT(*) AS candidate_count
  FROM distinct_candidates
  GROUP BY sale_id, tenant_id
),
unambiguous AS (
  SELECT candidate.sale_id, candidate.tenant_id, candidate.plan_id
  FROM distinct_candidates candidate
  JOIN candidate_counts counts
    ON counts.sale_id = candidate.sale_id
   AND counts.tenant_id = candidate.tenant_id
  JOIN historical_winners winner
    ON winner.sale_id = candidate.sale_id
   AND winner.tenant_id = candidate.tenant_id
   AND winner.plan_id = candidate.plan_id
  WHERE counts.candidate_count = 1
    AND NOT EXISTS (
      SELECT 1
      FROM commission_plans later_higher
      WHERE later_higher.tenant_id = candidate.tenant_id
        AND later_higher.created_at >= candidate.evidence_at
        AND later_higher.effective_from <= candidate.sale_date
        AND later_higher.effective_from > candidate.effective_from
    )
)
UPDATE sales sale
SET commission_plan_id = unambiguous.plan_id
FROM unambiguous
WHERE sale.id = unambiguous.sale_id
  AND sale.tenant_id = unambiguous.tenant_id
  AND sale.commission_plan_id IS NULL;
