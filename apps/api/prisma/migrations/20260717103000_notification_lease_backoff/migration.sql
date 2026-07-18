ALTER TABLE "notifications"
ADD COLUMN "available_at" TIMESTAMP(3),
ADD COLUMN "lease_token" UUID;

UPDATE "notifications"
SET "available_at" = CURRENT_TIMESTAMP
WHERE "status" = 'pending';

UPDATE "notifications"
SET "available_at" = "updated_at" + interval '5 minutes'
WHERE "status" = 'processing';

ALTER TABLE "notifications"
ALTER COLUMN "available_at" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "notifications_status_available_created_idx"
ON "notifications"("status", "available_at", "created_at");
