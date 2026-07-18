-- Recipient fields are authoritative only when captured by the reservation
-- code. Rows that predate the snapshot migration cannot be reconstructed from
-- mutable profiles without changing a prior payment instruction, so leave them
-- null and make batch export reject them for operator remediation.
DO $$
DECLARE
  snapshot_migration_started_at TIMESTAMPTZ;
BEGIN
  SELECT started_at
  INTO snapshot_migration_started_at
  FROM "_prisma_migrations"
  WHERE migration_name = '20260710152000_payout_batch_item_recipient_snapshots';

  IF snapshot_migration_started_at IS NOT NULL THEN
    UPDATE "payout_settlement_batch_items" AS item
    SET "recipient_referral_code" = NULL,
        "recipient_full_name" = NULL,
        "recipient_email" = NULL
    WHERE item.created_at < snapshot_migration_started_at;
  END IF;
END $$;
