import { Module } from '@nestjs/common';
import { NetworkHierarchyModule } from '../members/network-hierarchy.module';
import { PayoutComplianceModule } from '../payouts/payout-compliance.module';
import { WalletController } from './wallet.controller';
import { WalletService } from './wallet.service';

@Module({
  imports: [PayoutComplianceModule, NetworkHierarchyModule],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}
