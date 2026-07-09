-- Item 7: tek-satir sistem durumu (backup markeri).
CREATE TABLE "system_status" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "last_backup_at" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "system_status_pkey" PRIMARY KEY ("id")
);
