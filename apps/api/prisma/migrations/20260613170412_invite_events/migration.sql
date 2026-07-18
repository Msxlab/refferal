-- CreateTable
CREATE TABLE "invite_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "invite_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "utm_source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invite_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invite_events_tenant_id_created_at_idx" ON "invite_events"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "invite_events" ADD CONSTRAINT "invite_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invite_events" ADD CONSTRAINT "invite_events_invite_id_fkey" FOREIGN KEY ("invite_id") REFERENCES "invites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
