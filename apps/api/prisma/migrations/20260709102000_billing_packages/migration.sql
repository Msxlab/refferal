-- Item 10: billing paket katalogu + tenant atamasi.
CREATE TABLE "billing_packages" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "monthly_fee_cents" BIGINT NOT NULL,
  "features" JSONB NOT NULL DEFAULT '{}',
  "limits" JSONB NOT NULL DEFAULT '{}',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_packages_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_packages_key_key" ON "billing_packages"("key");

ALTER TABLE "tenant_billing" ADD COLUMN "package_id" UUID;
ALTER TABLE "tenant_billing" ADD COLUMN "overrides" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "tenant_billing" ADD CONSTRAINT "tenant_billing_package_id_fkey"
  FOREIGN KEY ("package_id") REFERENCES "billing_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
