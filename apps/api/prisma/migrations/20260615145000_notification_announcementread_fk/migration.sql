-- Orphan satir onleme: notifications.recipient_membership_id ve announcement_reads.membership_id
-- icin memberships'e FK (ON DELETE CASCADE). Uyelik silinince ilgili bildirim/okundu satirlari da gider.
-- Mevcut tum satirlar gercek bir uyeligi referansliyor (bildirimler uyelik id'lerinden uretilir),
-- bu yuzden FK eklenmesi guvenli.

-- AddForeignKey: notifications -> memberships
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_id_fkey"
  FOREIGN KEY ("recipient_membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: announcement_reads -> memberships
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_membership_id_fkey"
  FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
