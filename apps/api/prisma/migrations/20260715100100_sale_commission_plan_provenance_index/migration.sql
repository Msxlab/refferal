-- Keep this migration to one statement so PostgreSQL can build without a transaction.
CREATE INDEX CONCURRENTLY "sales_tenant_id_commission_plan_id_idx"
  ON "sales"("tenant_id", "commission_plan_id");
