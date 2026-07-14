-- Deployment precondition: plan/level history is append-only and its timestamps
-- are trusted. Out-of-band deletion or timestamp tampering is not detectable from
-- surviving rows. Subject to that boundary, only current timestamped plans and
-- immutable original commission rows may prove provenance below.
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
as_of_winners AS (
  -- Select the event-time winner before applying trust/signature filters. A
  -- corrupted newer winner must never make an older matching plan win instead.
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
  WHERE NOT EXISTS (
    SELECT 1
    FROM commission_plans higher
    WHERE higher.tenant_id = p.tenant_id
      AND higher.created_at < e.evidence_at
      AND higher.effective_from <= e.sale_date
      AND higher.effective_from > p.effective_from
  )
),
trusted_winners AS (
  SELECT w.sale_id, w.tenant_id, w.plan_id
  FROM as_of_winners w
  WHERE w.depth > 0
    AND w.plan_updated_at < w.evidence_at
    -- now() on ledger rows is the engine transaction start. A higher plan that
    -- appears after that cutoff could be late-backdated or could have committed
    -- before lookup; without a resolution timestamp the sale stays unpinned.
    AND NOT EXISTS (
      SELECT 1
      FROM commission_plans later_higher
      WHERE later_higher.tenant_id = w.tenant_id
        AND later_higher.created_at >= w.evidence_at
        AND later_higher.effective_from <= w.sale_date
        AND later_higher.effective_from > w.effective_from
    )
    -- The current complete level snapshot must already have existed unchanged.
    AND (
      SELECT COUNT(*)
      FROM commission_plan_levels snapshot_count
      WHERE snapshot_count.plan_id = w.plan_id
    ) = w.depth
    AND NOT EXISTS (
      SELECT 1
      FROM commission_plan_levels snapshot_level
      WHERE snapshot_level.plan_id = w.plan_id
        AND (
          snapshot_level.level < 0
          OR snapshot_level.level >= w.depth
          OR snapshot_level.created_at >= w.evidence_at
          OR snapshot_level.updated_at >= w.evidence_at
        )
    )
    -- Every original row must match the winner's exact level/rate and integer
    -- floor amount. Missing uplines may omit unused plan levels, but no written
    -- level may sit outside the plan depth.
    AND NOT EXISTS (
      SELECT 1
      FROM ledger_entries le
      WHERE le.sale_id = w.sale_id
        AND le.type = 'commission'
        AND (
          le.tenant_id IS DISTINCT FROM w.tenant_id
          OR le.level < 0
          OR le.level >= w.depth
          OR le.amount_cents <= 0
          OR FLOOR((w.amount_cents::numeric * le.rate_bps_used::numeric) / 10000)
             IS DISTINCT FROM le.amount_cents::numeric
          OR NOT EXISTS (
            SELECT 1
            FROM commission_plan_levels matched_level
            WHERE matched_level.plan_id = w.plan_id
              AND matched_level.level = le.level
              AND matched_level.rate_bps = le.rate_bps_used
              AND matched_level.created_at < w.evidence_at
              AND matched_level.updated_at < w.evidence_at
          )
        )
    )
),
distinct_candidates AS (
  SELECT DISTINCT sale_id, tenant_id, plan_id
  FROM trusted_winners
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
  WHERE counts.candidate_count = 1
)
UPDATE sales s
SET commission_plan_id = unambiguous.plan_id
FROM unambiguous
WHERE s.id = unambiguous.sale_id
  AND s.tenant_id = unambiguous.tenant_id
  AND s.commission_plan_id IS NULL;
