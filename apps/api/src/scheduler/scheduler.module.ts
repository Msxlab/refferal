import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { EngineModule } from '../engine/engine.module';
import { FraudModule } from '../fraud/fraud.module';
import { PayoutsModule } from '../payouts/payouts.module';
import { ReportsModule } from '../reports/reports.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [EngineModule, ReportsModule, FraudModule, WebhooksModule, CampaignsModule, PayoutsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
