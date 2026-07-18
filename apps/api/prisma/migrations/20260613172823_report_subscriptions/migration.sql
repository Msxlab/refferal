-- CreateTable
CREATE TABLE "report_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "frequency" TEXT NOT NULL DEFAULT 'weekly',
    "recipients" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "report_subscriptions_tenant_id_key" ON "report_subscriptions"("tenant_id");

-- AddForeignKey
ALTER TABLE "report_subscriptions" ADD CONSTRAINT "report_subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
