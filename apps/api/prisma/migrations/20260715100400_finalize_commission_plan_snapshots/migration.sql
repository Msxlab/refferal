-- Existing rows become visible only when their level snapshot is complete and contiguous.
-- New rows start hidden and must be finalized in the same transaction that creates levels.
DROP TRIGGER "trg_forbid_commission_plan_mutation" ON "commission_plans";

ALTER TABLE "commission_plans"
  ADD COLUMN "finalized" BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE "commission_plans" plan
SET "finalized" = TRUE
WHERE plan."depth" > 0
  AND (
    SELECT COUNT(*)
    FROM "commission_plan_levels" level
    WHERE level."plan_id" = plan."id"
  ) = plan."depth"
  AND NOT EXISTS (
    SELECT 1
    FROM generate_series(0, plan."depth" - 1) expected(level)
    WHERE NOT EXISTS (
      SELECT 1
      FROM "commission_plan_levels" actual
      WHERE actual."plan_id" = plan."id"
        AND actual."level" = expected.level
    )
  );

CREATE OR REPLACE FUNCTION enforce_commission_plan_insert_unfinalized() RETURNS trigger AS $$
BEGIN
  IF NEW.finalized THEN
    RAISE EXCEPTION 'new commission plan snapshots must start unfinalized'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_enforce_commission_plan_insert_unfinalized"
BEFORE INSERT ON "commission_plans"
FOR EACH ROW EXECUTE FUNCTION enforce_commission_plan_insert_unfinalized();

CREATE OR REPLACE FUNCTION forbid_commission_plan_mutation() RETURNS trigger AS $$
DECLARE
  level_count integer;
  missing_level boolean;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.finalized = FALSE
     AND NEW.finalized = TRUE
     AND (to_jsonb(NEW) - 'finalized' - 'updated_at')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - 'finalized' - 'updated_at') THEN
    SELECT COUNT(*)
    INTO level_count
    FROM commission_plan_levels level
    WHERE level.plan_id = NEW.id;

    SELECT EXISTS (
      SELECT 1
      FROM generate_series(0, NEW.depth - 1) expected(level)
      WHERE NOT EXISTS (
        SELECT 1
        FROM commission_plan_levels actual
        WHERE actual.plan_id = NEW.id
          AND actual.level = expected.level
      )
    )
    INTO missing_level;

    IF level_count = NEW.depth AND NOT missing_level THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'commission plan snapshot cannot be finalized before levels 0..depth-1 are complete'
      USING ERRCODE = '23514';
  END IF;

  RAISE EXCEPTION 'commission plan versions are immutable; create a new version'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_forbid_commission_plan_mutation"
BEFORE UPDATE OR DELETE ON "commission_plans"
FOR EACH ROW EXECUTE FUNCTION forbid_commission_plan_mutation();

CREATE OR REPLACE FUNCTION guard_commission_plan_level_insert() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM commission_plans plan
    WHERE plan.id = NEW.plan_id
      AND plan.finalized = TRUE
  ) THEN
    RAISE EXCEPTION 'finalized commission plan levels are immutable; create a new plan version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_guard_commission_plan_level_insert"
BEFORE INSERT ON "commission_plan_levels"
FOR EACH ROW EXECUTE FUNCTION guard_commission_plan_level_insert();
