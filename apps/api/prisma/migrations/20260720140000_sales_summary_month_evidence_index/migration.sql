-- Keep this migration to one statement so PostgreSQL can build without a transaction.
CREATE INDEX CONCURRENTLY "sales_tenant_status_summary_month_sale_date_idx"
ON "sales"("tenant_id", "status", "summary_month", "sale_date" DESC);
