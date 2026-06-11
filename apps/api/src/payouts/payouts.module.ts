import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { AdminPayoutsController, AppPayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  imports: [EngineModule],
  controllers: [AdminPayoutsController, AppPayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
