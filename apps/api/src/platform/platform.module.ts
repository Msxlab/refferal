import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  controllers: [PlatformController],
  providers: [PlatformService, BillingService],
})
export class PlatformModule {}
