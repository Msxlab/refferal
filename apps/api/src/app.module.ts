import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountModule } from './account/account.module';
import { AnnouncementsModule } from './announcements/announcements.module';
import { ApiKeysModule } from './apikeys/apikeys.module';
import { AuthModule } from './auth/auth.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { ChecksModule } from './checks/checks.module';
import { EngineModule } from './engine/engine.module';
import { EventsModule } from './events/events.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { FraudModule } from './fraud/fraud.module';
import { HealthModule } from './health/health.module';
import { InvitesModule } from './invites/invites.module';
import { KycModule } from './kyc/kyc.module';
import { MeModule } from './memberships/me.module';
import { MembersAdminModule } from './members/members.admin.module';
import { MembershipsModule } from './memberships/memberships.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PeriodsModule } from './periods/periods.module';
import { PlansModule } from './plans/plans.module';
import { PlatformModule } from './platform/platform.module';
import { PrismaModule } from './prisma/prisma.module';
import { RanksModule } from './ranks/ranks.module';
import { RbacModule } from './rbac/rbac.module';
import { ReportsModule } from './reports/reports.module';
import { SanctionsModule } from './sanctions/sanctions.module';
import { SearchModule } from './search/search.module';
import { SalesModule } from './sales/sales.module';
import { SettingsModule } from './settings/settings.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { SurveyModule } from './survey/survey.module';
import { ViewsModule } from './views/views.module';
import { WalletModule } from './wallet/wallet.module';

const isTest = process.env.NODE_ENV === 'test';

// Global rate-limit (SPEC 10). MVP: in-memory (tek instance). Cok-instance icin
// Redis store'a gecilir (DECISIONS). Testte skipIf ile kapali — mevcut testleri tetiklemesin.
const THROTTLE_TTL_MS = Number(process.env.THROTTLE_TTL_MS ?? 60_000);
const THROTTLE_LIMIT = Number(process.env.THROTTLE_LIMIT ?? 120);

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: THROTTLE_TTL_MS, limit: THROTTLE_LIMIT }],
      skipIf: () => isTest,
    }),
    // Scheduler testte kapali: cron'un test DB'sinde tetiklenmesini/kayit cakismasini onler
    ...(isTest ? [] : [ScheduleModule.forRoot(), SchedulerModule]),
    PrismaModule,
    EngineModule,
    EventsModule,
    AuthModule,
    AccountModule,
    MembershipsModule,
    MeModule,
    InvitesModule,
    SalesModule,
    WalletModule,
    PayoutsModule,
    ChecksModule,
    PeriodsModule,
    PlansModule,
    MembersAdminModule,
    ReportsModule,
    NotificationsModule,
    SettingsModule,
    RbacModule,
    PlatformModule,
    CampaignsModule,
    ViewsModule,
    KycModule,
    FraudModule,
    SearchModule,
    SurveyModule,
    SanctionsModule,
    RanksModule,
    ApiKeysModule,
    WebhooksModule,
    AnnouncementsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
