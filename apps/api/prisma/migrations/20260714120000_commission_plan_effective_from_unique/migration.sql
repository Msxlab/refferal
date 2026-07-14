DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "commission_plans"
    GROUP BY "tenant_id", "effective_from"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'cannot enforce commission plan effective-date uniqueness: duplicate tenant_id/effective_from groups exist'
      USING ERRCODE = '23505';
  END IF;
END
$$;

ALTER TABLE "commission_plans"
  ADD CONSTRAINT "commission_plans_tenant_id_effective_from_key"
  UNIQUE ("tenant_id", "effective_from");

DROP INDEX IF EXISTS "commission_plans_tenant_id_effective_from_idx";
