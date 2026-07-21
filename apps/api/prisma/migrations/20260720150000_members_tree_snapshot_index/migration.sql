-- Keep this migration to one statement so PostgreSQL can build without a transaction.
CREATE INDEX CONCURRENTLY "memberships_tenant_depth_joined_id_idx"
ON "memberships"("tenant_id", "depth", "joined_at", "id");
