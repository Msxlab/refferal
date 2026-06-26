import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { SanctionsModule } from '../sanctions/sanctions.module';
import { AdminPayoutsController, AppPayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';
import { PayoutEstimateService } from './payout-estimate.service';

@Module({
  imports: [EngineModule, WebhooksModule, SanctionsModule],
  controllers: [AdminPayoutsController, AppPayoutsController],
  providers: [PayoutsService, PayoutEstimateService],
  exports: [PayoutsService, PayoutEstimateService],
})
export class PayoutsModule {}
