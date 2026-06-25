import { Module } from '@nestjs/common';
import { SanctionsModule } from '../sanctions/sanctions.module';
import { AdminKycController, AppKycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  imports: [SanctionsModule],
  controllers: [AppKycController, AdminKycController],
  providers: [KycService],
})
export class KycModule {}
