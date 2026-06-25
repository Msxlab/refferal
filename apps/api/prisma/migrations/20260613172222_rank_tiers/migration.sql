-- CreateTable
CREATE TABLE "rank_tiers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "min_team" INTEGER NOT NULL DEFAULT 0,
    "min_earnings_cents" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rank_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rank_tiers_tenant_id_sort_order_idx" ON "rank_tiers"("tenant_id", "sort_order");

-- AddForeignKey
ALTER TABLE "rank_tiers" ADD CONSTRAINT "rank_tiers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
