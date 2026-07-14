-- Keep this migration to one statement: Prisma/PostgreSQL otherwise executes
-- multiple statements in one implicit transaction, which CONCURRENTLY rejects.
-- If an interrupted build leaves this index invalid, drop it with
-- DROP INDEX CONCURRENTLY, mark this migration rolled back, then rerun deploy.
CREATE INDEX CONCURRENTLY "sales_tenant_id_commission_plan_id_idx"
  ON "sales"("tenant_id", "commission_plan_id");
