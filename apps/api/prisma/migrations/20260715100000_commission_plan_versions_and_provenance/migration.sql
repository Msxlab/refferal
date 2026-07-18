-- Fail closed if the pre-version data cannot support deterministic active-plan lookup.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "commission_plans"
    GROUP BY "tenant_id", "effective_from"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot version commission plans: duplicate tenant_id/effective_from groups exist'
      USING ERRCODE = '23505';
  END IF;
END
$$;

ALTER TABLE "commission_plans"
  ADD COLUMN "version" INTEGER;

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenant_id"
      ORDER BY "effective_from" ASC, "created_at" ASC, "id" ASC
    ) AS version
  FROM "commission_plans"
)
UPDATE "commission_plans" plan
SET "version" = ranked.version::integer
FROM ranked
WHERE plan."id" = ranked."id";

ALTER TABLE "commission_plans"
  ALTER COLUMN "version" SET NOT NULL,
  ADD CONSTRAINT "chk_commission_plan_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "commission_plans_tenant_id_effective_from_key" UNIQUE ("tenant_id", "effective_from"),
  ADD CONSTRAINT "commission_plans_tenant_id_version_key" UNIQUE ("tenant_id", "version"),
  ADD CONSTRAINT "commission_plans_tenant_id_id_key" UNIQUE ("tenant_id", "id");

DROP INDEX IF EXISTS "commission_plans_tenant_id_effective_from_idx";

ALTER TABLE "sales"
  ADD COLUMN "commission_plan_id" UUID;

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_tenant_id_commission_plan_id_fkey"
  FOREIGN KEY ("tenant_id", "commission_plan_id")
  REFERENCES "commission_plans"("tenant_id", "id")
  ON DELETE RESTRICT
  ON UPDATE RESTRICT
  NOT VALID;

-- A plan and all of its levels are an immutable version snapshot. Corrections are INSERTs.
CREATE OR REPLACE FUNCTION forbid_commission_plan_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commission plan versions are immutable; create a new version'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_commission_plan_mutation
BEFORE UPDATE OR DELETE ON "commission_plans"
FOR EACH ROW EXECUTE FUNCTION forbid_commission_plan_mutation();

CREATE OR REPLACE FUNCTION forbid_commission_plan_level_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'commission plan level versions are immutable; create a new plan version'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_commission_plan_level_mutation
BEFORE UPDATE OR DELETE ON "commission_plan_levels"
FOR EACH ROW EXECUTE FUNCTION forbid_commission_plan_level_mutation();
