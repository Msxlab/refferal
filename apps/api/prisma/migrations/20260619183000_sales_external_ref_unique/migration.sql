-- CRM/order idempotency: one non-null external_ref per tenant.
-- Multiple NULLs remain allowed.
CREATE UNIQUE INDEX IF NOT EXISTS sales_tenant_external_ref_uidx
  ON sales (tenant_id, external_ref)
  WHERE external_ref IS NOT NULL;
