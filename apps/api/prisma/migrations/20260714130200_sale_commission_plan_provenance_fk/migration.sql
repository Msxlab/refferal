DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sales_tenant_id_commission_plan_id_fkey'
      AND conrelid = 'sales'::regclass
  ) THEN
    ALTER TABLE "sales"
      ADD CONSTRAINT "sales_tenant_id_commission_plan_id_fkey"
      FOREIGN KEY ("tenant_id", "commission_plan_id")
      REFERENCES "commission_plans"("tenant_id", "id")
      ON DELETE RESTRICT
      ON UPDATE RESTRICT
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE "sales"
  VALIDATE CONSTRAINT "sales_tenant_id_commission_plan_id_fkey";
