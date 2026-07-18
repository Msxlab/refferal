-- Keep the maker-checker batch contract aligned with the Prisma schema.
-- Existing rows from the original reserve migration may have a NULL array.
UPDATE payout_batches
SET membership_ids = '{}'::text[]
WHERE membership_ids IS NULL;

ALTER TABLE payout_batches
ALTER COLUMN membership_ids SET NOT NULL;
