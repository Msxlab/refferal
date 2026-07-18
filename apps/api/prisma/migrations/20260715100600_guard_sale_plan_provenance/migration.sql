CREATE OR REPLACE FUNCTION guard_sale_commission_plan_pin() RETURNS trigger AS $$
BEGIN
  IF OLD.commission_plan_id IS NULL
     OR NEW.commission_plan_id IS NOT DISTINCT FROM OLD.commission_plan_id THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'sale commission plan provenance is immutable after the first pin'
    USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "trg_guard_sale_commission_plan_pin"
BEFORE UPDATE OF "commission_plan_id" ON "sales"
FOR EACH ROW EXECUTE FUNCTION guard_sale_commission_plan_pin();
