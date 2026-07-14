ALTER TABLE "sales"
  ADD COLUMN "commission_plan_id" UUID;

ALTER TABLE "commission_plans"
  ADD CONSTRAINT "commission_plans_tenant_id_id_key"
  UNIQUE ("tenant_id", "id");

CREATE INDEX "sales_tenant_id_commission_plan_id_idx"
  ON "sales"("tenant_id", "commission_plan_id");

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_tenant_id_commission_plan_id_fkey"
  FOREIGN KEY ("tenant_id", "commission_plan_id")
  REFERENCES "commission_plans"("tenant_id", "id")
  ON DELETE RESTRICT
  ON UPDATE RESTRICT
  NOT VALID;

ALTER TABLE "sales"
  VALIDATE CONSTRAINT "sales_tenant_id_commission_plan_id_fkey";
