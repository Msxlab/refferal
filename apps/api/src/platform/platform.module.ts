import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { BillingService } from './billing.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [PlatformController],
  providers: [PlatformService, BillingService],
})
export class PlatformModule {}
