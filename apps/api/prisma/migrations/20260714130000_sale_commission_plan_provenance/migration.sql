ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "commission_plan_id" UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'commission_plans_tenant_id_id_key'
      AND conrelid = 'commission_plans'::regclass
  ) THEN
    ALTER TABLE "commission_plans"
      ADD CONSTRAINT "commission_plans_tenant_id_id_key"
      UNIQUE ("tenant_id", "id");
  END IF;
END
$$;
