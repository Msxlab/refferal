-- DB-katmani korkuluklar (SPEC 3.2 / 6 / 7 degismezleri — ikinci kilit).

-- ltree extension aktif (SPEC 5). memberships.path ltree-uyumlu TEXT tutar;
-- GiST index / ltree cast'i agac sorgulari gerektirdiginde eklenecek (docs/DECISIONS.md).
CREATE EXTENSION IF NOT EXISTS ltree;

-- Sinir kontrolleri
ALTER TABLE commission_plans
  ADD CONSTRAINT chk_pool_rate_bps CHECK (pool_rate_bps >= 0 AND pool_rate_bps <= 10000),
  ADD CONSTRAINT chk_plan_depth CHECK (depth >= 1 AND depth <= 8);

ALTER TABLE commission_plan_levels
  ADD CONSTRAINT chk_rate_bps CHECK (rate_bps >= 0 AND rate_bps <= 10000),
  ADD CONSTRAINT chk_level_range CHECK (level >= 0 AND level <= 7);

ALTER TABLE sales
  ADD CONSTRAINT chk_sale_amount CHECK (amount_cents >= 0);

ALTER TABLE payouts
  ADD CONSTRAINT chk_payout_total CHECK (total_cents >= 0);

-- SUM(level_rates) <= pool_rate (SPEC 3.2) — DEFERRABLE: transaction sonunda kontrol,
-- boylece plan + level'lar tek transaction'da serbest sirayla yazilabilir.
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

  SELECT COALESCE(SUM(rate_bps), 0) INTO v_total FROM commission_plan_levels WHERE plan_id = v_plan_id;
  SELECT pool_rate_bps INTO v_pool FROM commission_plans WHERE id = v_plan_id;

  IF v_pool IS NOT NULL AND v_total > v_pool THEN
    RAISE EXCEPTION 'plan % seviye oranlari toplami (% bps) havuz oranini (% bps) asiyor',
      v_plan_id, v_total, v_pool;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_plan_level_rates
AFTER INSERT OR UPDATE ON commission_plan_levels
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_plan_level_rates();

-- pool_rate dusurulurse mevcut seviye toplamiyla celismemeli
CREATE OR REPLACE FUNCTION check_plan_pool_shrink() RETURNS trigger AS $$
DECLARE
  v_total integer;
BEGIN
  SELECT COALESCE(SUM(rate_bps), 0) INTO v_total FROM commission_plan_levels WHERE plan_id = NEW.id;
  IF v_total > NEW.pool_rate_bps THEN
    RAISE EXCEPTION 'plan % havuz orani (% bps) mevcut seviye toplaminin (% bps) altina dusurulemez',
      NEW.id, NEW.pool_rate_bps, v_total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_check_plan_pool_shrink
AFTER UPDATE OF pool_rate_bps ON commission_plans
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION check_plan_pool_shrink();

-- Yerlesim KALICIDIR (SPEC 2 Non-Goals: re-parenting asla).
-- path yalnizca ilk doldurmada ('' -> deger) yazilabilir.
CREATE OR REPLACE FUNCTION forbid_reparenting() RETURNS trigger AS $$
BEGIN
  IF NEW.sponsor_membership_id IS DISTINCT FROM OLD.sponsor_membership_id THEN
    RAISE EXCEPTION 'memberships.sponsor_membership_id degistirilemez (re-parenting yasak)';
  END IF;
  IF OLD.path <> '' AND NEW.path IS DISTINCT FROM OLD.path THEN
    RAISE EXCEPTION 'memberships.path degistirilemez (yerlesim kalicidir)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_reparenting
BEFORE UPDATE ON memberships
FOR EACH ROW EXECUTE FUNCTION forbid_reparenting();

-- Ledger SILINMEZ; guncellenebilir alanlar yalnizca status / payout_id / matures_at (SPEC 6).
CREATE OR REPLACE FUNCTION guard_ledger_update() RETURNS trigger AS $$
BEGIN
  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
     OR NEW.sale_id IS DISTINCT FROM OLD.sale_id
     OR NEW.beneficiary_membership_id IS DISTINCT FROM OLD.beneficiary_membership_id
     OR NEW.level IS DISTINCT FROM OLD.level
     OR NEW.rate_bps_used IS DISTINCT FROM OLD.rate_bps_used
     OR NEW.type IS DISTINCT FROM OLD.type
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'ledger satiri degistirilemez; duzeltme = yeni satir (reversal/adjustment)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_ledger_update
BEFORE UPDATE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION guard_ledger_update();

CREATE OR REPLACE FUNCTION forbid_ledger_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger satiri silinemez';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_forbid_ledger_delete
BEFORE DELETE ON ledger_entries
FOR EACH ROW EXECUTE FUNCTION forbid_ledger_delete();
