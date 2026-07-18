import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PayoutComplianceService } from './payout-compliance.service';

@Module({
  imports: [PrismaModule],
  providers: [PayoutComplianceService],
  exports: [PayoutComplianceService],
})
export class PayoutComplianceModule {}
