import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { EngineModule } from './engine/engine.module';
import { InvitesModule } from './invites/invites.module';
import { MeModule } from './memberships/me.module';
import { MembersAdminModule } from './members/members.admin.module';
import { MembershipsModule } from './memberships/memberships.module';
import { PayoutsModule } from './payouts/payouts.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportsModule } from './reports/reports.module';
import { SalesModule } from './sales/sales.module';
import { SchedulerModule } from './scheduler/scheduler.module';
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
    AuthModule,
    MembershipsModule,
    MeModule,
    InvitesModule,
    SalesModule,
    WalletModule,
    PayoutsModule,
    MembersAdminModule,
    ReportsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
