ALTER TABLE "notifications"
  ADD COLUMN "recipient_user_id" UUID,
  ALTER COLUMN "recipient_membership_id" DROP NOT NULL;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_recipient_user_id_fkey"
  FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "notifications_recipient_user_id_channel_read_at_idx"
  ON "notifications"("recipient_user_id", "channel", "read_at");

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_exactly_one_recipient_check"
  CHECK (("recipient_membership_id" IS NOT NULL) <> ("recipient_user_id" IS NOT NULL))
  NOT VALID;

ALTER TABLE "notifications"
  VALIDATE CONSTRAINT "notifications_exactly_one_recipient_check";
