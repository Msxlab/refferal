import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { AdminPayoutsController, AppPayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [EngineModule, WebhooksModule],
  controllers: [AdminPayoutsController, AppPayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
