-- Refuse to optimize traversal over a hierarchy whose tenant/path invariants are broken.
-- This migration is intentionally non-destructive: it reports bad rows and changes no placement data.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM memberships child
    JOIN memberships sponsor ON sponsor.id = child.sponsor_membership_id
    WHERE child.sponsor_membership_id IS NOT NULL
      AND child.tenant_id <> sponsor.tenant_id
  ) THEN
    RAISE EXCEPTION 'network hierarchy preflight failed: cross-tenant sponsors exist';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM memberships root
    WHERE root.sponsor_membership_id IS NULL
      AND (
        root.depth <> 0
        OR root.path <> replace(root.id::text, '-', '_')
      )
  ) THEN
    RAISE EXCEPTION 'network hierarchy preflight failed: root path/depth mismatch exists';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM memberships child
    JOIN memberships sponsor ON sponsor.id = child.sponsor_membership_id
    WHERE child.sponsor_membership_id IS NOT NULL
      AND (
        child.depth <> sponsor.depth + 1
        OR child.path <> sponsor.path || '.' || replace(child.id::text, '-', '_')
      )
  ) THEN
    RAISE EXCEPTION 'network hierarchy preflight failed: parent path/depth mismatch exists';
  END IF;
END $$;

CREATE INDEX "memberships_tenant_sponsor_joined_id_idx"
ON "memberships"("tenant_id", "sponsor_membership_id", "joined_at", "id");
