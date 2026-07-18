-- Durable idempotency record for reviewed sales bulk mutations.
CREATE TABLE "bulk_action_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID NOT NULL,
    "idempotency_key_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bulk_action_executions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bulk_action_exec_key_hash_chk"
      CHECK ("idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "bulk_action_exec_request_hash_chk"
      CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "bulk_action_exec_status_chk"
      CHECK ("status" IN ('processing', 'completed')),
    CONSTRAINT "bulk_action_exec_response_state_chk"
      CHECK (
        ("status" = 'processing' AND "response" IS NULL)
        OR ("status" = 'completed' AND "response" IS NOT NULL)
      )
);

CREATE UNIQUE INDEX "bulk_action_exec_tenant_actor_key_uidx"
ON "bulk_action_executions"("tenant_id", "actor_user_id", "idempotency_key_hash");

ALTER TABLE "bulk_action_executions"
ADD CONSTRAINT "bulk_action_executions_tenant_id_fkey"
FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bulk_action_executions"
ADD CONSTRAINT "bulk_action_executions_actor_user_id_fkey"
FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
