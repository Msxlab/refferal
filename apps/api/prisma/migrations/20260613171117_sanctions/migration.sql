-- AlterTable
ALTER TABLE "payout_profiles" ADD COLUMN     "sanctions_hit" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "sanctions_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'OFAC',
    "country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sanctions_entries_normalized_name_idx" ON "sanctions_entries"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "sanctions_entries_source_normalized_name_key" ON "sanctions_entries"("source", "normalized_name");
