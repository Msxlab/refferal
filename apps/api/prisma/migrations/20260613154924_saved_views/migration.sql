-- CreateTable
CREATE TABLE "saved_views" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_views_tenant_id_target_idx" ON "saved_views"("tenant_id", "target");

-- AddForeignKey
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
