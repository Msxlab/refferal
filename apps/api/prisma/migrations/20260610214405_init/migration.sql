-- CreateEnum
CREATE TYPE "Role" AS ENUM ('platform_admin', 'tenant_owner', 'tenant_admin', 'tenant_staff', 'member');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('active', 'used', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "MaturationRule" AS ENUM ('on_approval', 'on_delivery', 'days_after_approval');

-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('draft', 'approved', 'void');

-- CreateEnum
CREATE TYPE "LedgerType" AS ENUM ('commission', 'reversal', 'adjustment');

-- CreateEnum
CREATE TYPE "LedgerStatus" AS ENUM ('pending', 'payable', 'paid', 'reversed');

-- CreateEnum
CREATE TYPE "PayoutMethod" AS ENUM ('manual', 'csv', 'stripe');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('requested', 'processing', 'paid', 'failed');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('push', 'email');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'failed');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "maturation_rule" "MaturationRule" NOT NULL DEFAULT 'on_delivery',
    "maturation_days" INTEGER,
    "payout_min_cents" BIGINT NOT NULL DEFAULT 100000,
    "compression_enabled" BOOLEAN NOT NULL DEFAULT false,
    "inactive_members_earn" BOOLEAN NOT NULL DEFAULT true,
    "notify_new_member_name" BOOLEAN NOT NULL DEFAULT true,
    "branding" JSONB NOT NULL DEFAULT '{}',
    "status" "TenantStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "avatar_path" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "email_verified_at" TIMESTAMP(3),
    "totp_secret" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'member',
    "sponsor_membership_id" UUID,
    "referral_code" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "depth" INTEGER NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'active',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "inviter_membership_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_by_membership_id" UUID,
    "status" "InviteStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "pool_rate_bps" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_plan_levels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "plan_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "rate_bps" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_plan_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "seller_membership_id" UUID NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "customer_ref" TEXT,
    "sale_date" TIMESTAMP(3) NOT NULL,
    "status" "SaleStatus" NOT NULL DEFAULT 'draft',
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "external_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "beneficiary_membership_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "rate_bps_used" INTEGER NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "type" "LedgerType" NOT NULL,
    "status" "LedgerStatus" NOT NULL,
    "matures_at" TIMESTAMP(3),
    "payout_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monthly_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "pending_cents" BIGINT NOT NULL DEFAULT 0,
    "payable_cents" BIGINT NOT NULL DEFAULT 0,
    "paid_cents" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_stats" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "member_count" INTEGER NOT NULL DEFAULT 0,
    "active_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "total_cents" BIGINT NOT NULL,
    "method" "PayoutMethod" NOT NULL DEFAULT 'manual',
    "status" "PayoutStatus" NOT NULL DEFAULT 'requested',
    "period" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "expo_push_token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "recipient_membership_id" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "template" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" UUID,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_sponsor_membership_id_idx" ON "memberships"("tenant_id", "sponsor_membership_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_path_idx" ON "memberships"("tenant_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_referral_code_key" ON "memberships"("tenant_id", "referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "invites_code_key" ON "invites"("code");

-- CreateIndex
CREATE INDEX "invites_tenant_id_status_idx" ON "invites"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "commission_plans_tenant_id_effective_from_idx" ON "commission_plans"("tenant_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "commission_plan_levels_plan_id_level_key" ON "commission_plan_levels"("plan_id", "level");

-- CreateIndex
CREATE INDEX "sales_tenant_id_status_idx" ON "sales"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "sales_tenant_id_sale_date_idx" ON "sales"("tenant_id", "sale_date");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_beneficiary_membership_id_status_idx" ON "ledger_entries"("tenant_id", "beneficiary_membership_id", "status");

-- CreateIndex
CREATE INDEX "ledger_entries_status_matures_at_idx" ON "ledger_entries"("status", "matures_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_sale_id_level_type_key" ON "ledger_entries"("sale_id", "level", "type");

-- CreateIndex
CREATE INDEX "monthly_summaries_tenant_id_month_idx" ON "monthly_summaries"("tenant_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "monthly_summaries_tenant_id_membership_id_month_level_key" ON "monthly_summaries"("tenant_id", "membership_id", "month", "level");

-- CreateIndex
CREATE UNIQUE INDEX "team_stats_tenant_id_membership_id_level_key" ON "team_stats"("tenant_id", "membership_id", "level");

-- CreateIndex
CREATE INDEX "payouts_tenant_id_status_idx" ON "payouts"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_expo_push_token_key" ON "devices"("expo_push_token");

-- CreateIndex
CREATE INDEX "notifications_status_created_at_idx" ON "notifications"("status", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_sponsor_membership_id_fkey" FOREIGN KEY ("sponsor_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invites" ADD CONSTRAINT "invites_inviter_membership_id_fkey" FOREIGN KEY ("inviter_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plans" ADD CONSTRAINT "commission_plans_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_plan_levels" ADD CONSTRAINT "commission_plan_levels_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "commission_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_seller_membership_id_fkey" FOREIGN KEY ("seller_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_beneficiary_membership_id_fkey" FOREIGN KEY ("beneficiary_membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_stats" ADD CONSTRAINT "team_stats_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_stats" ADD CONSTRAINT "team_stats_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
