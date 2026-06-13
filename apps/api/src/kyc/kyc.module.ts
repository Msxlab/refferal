import { Module } from '@nestjs/common';
import { AdminKycController, AppKycController } from './kyc.controller';
import { KycService } from './kyc.service';

@Module({
  controllers: [AppKycController, AdminKycController],
  providers: [KycService],
})
export class KycModule {}
