-- Faz C2: platform billing — tenant-sirket faturalama (manuel takip; Stripe/odeme-gecidi YOK).

CREATE TYPE "InvoiceStatus" AS ENUM ('open', 'paid', 'void');

CREATE TABLE "tenant_billing" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "monthly_fee_cents" BIGINT NOT NULL DEFAULT 0,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tenant_billing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tenant_billing_tenant_id_key" ON "tenant_billing"("tenant_id");
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "invoices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "period" TEXT NOT NULL,
  "amount_cents" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" "InvoiceStatus" NOT NULL DEFAULT 'open',
  "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_at" TIMESTAMP(3),
  "paid_at" TIMESTAMP(3),
  "paid_note" TEXT,
  "marked_by_user_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invoices_tenant_id_period_key" ON "invoices"("tenant_id", "period");
CREATE INDEX "invoices_status_issued_at_idx" ON "invoices"("status", "issued_at");
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
