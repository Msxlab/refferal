import { Module } from '@nestjs/common';
import { PayoutComplianceModule } from '../payouts/payout-compliance.module';
import { EngineService } from './engine.service';

@Module({
  imports: [PayoutComplianceModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
