import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { EngineModule } from '../engine/engine.module';
import { HealthModule } from '../health/health.module';
import { FraudModule } from '../fraud/fraud.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { RanksModule } from '../ranks/ranks.module';
import { ReportsModule } from '../reports/reports.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [EngineModule, HealthModule, ReportsModule, FraudModule, WebhooksModule, CampaignsModule, PayoutsModule, RanksModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
