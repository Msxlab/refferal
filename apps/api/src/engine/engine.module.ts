import { Module } from '@nestjs/common';
import { PayoutComplianceModule } from '../payouts/payout-compliance.module';
import { RanksModule } from '../ranks/ranks.module';
import { EngineService } from './engine.service';

@Module({
  imports: [PayoutComplianceModule, RanksModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
