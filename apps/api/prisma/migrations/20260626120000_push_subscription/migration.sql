-- Web Push (VAPID) subscriptions
CREATE TABLE "push_subscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription"("user_id");

ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
