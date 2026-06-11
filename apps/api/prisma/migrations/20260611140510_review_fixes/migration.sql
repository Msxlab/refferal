-- DropForeignKey
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_payout_id_fkey";

-- AlterTable
ALTER TABLE "sales" ADD COLUMN     "summary_month" TEXT;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Inceleme bulgusu (plan-trigger-race): DEFERRABLE trigger'in kilitsiz SELECT'i
-- READ COMMITTED altinda eszamanli commit'leri kacirip SUM(rate_bps) > pool_rate_bps
-- olusturabiliyordu. Cozum: SUM'dan ONCE plan satirini FOR UPDATE ile kilitle —
-- ayni plana yazan iki transaction serilesir, ikincisi digerinin commit'li satirlarini gorur.
CREATE OR REPLACE FUNCTION check_plan_level_rates() RETURNS trigger AS $$
DECLARE
  v_plan_id uuid;
  v_total integer;
  v_pool integer;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_plan_id := OLD.plan_id;
  ELSE
    v_plan_id := NEW.plan_id;
  END IF;

  -- Ayni plana eszamanli yazimlari serilestir (satir kilidi commit'e kadar tutulur).
  SELECT pool_rate_bps INTO v_pool FROM commission_plans WHERE id = v_plan_id FOR UPDATE;

  SELECT COALESCE(SUM(rate_bps), 0) INTO v_total FROM commission_plan_levels WHERE plan_id = v_plan_id;

  IF v_pool IS NOT NULL AND v_total > v_pool THEN
    RAISE EXCEPTION 'plan % seviye oranlari toplami (% bps) havuz oranini (% bps) asiyor',
      v_plan_id, v_total, v_pool;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
