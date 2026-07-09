import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { BillingService } from './billing.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

// Item 7: SchedulerModule testte AppModule'e hic import edilmiyor (bkz. app.module.ts:55) —
// bu yuzden SchedulerService de testte DI grafinde yok. PlatformService @Optional() ile enjekte
// eder; burada da ayni isTest kapisiyla import ediyoruz ki testte "bilinmeyen provider" hatasi olmasin.
const isTest = process.env.NODE_ENV === 'test';

@Module({
  imports: [JwtModule.register({}), ...(isTest ? [] : [SchedulerModule])],
  controllers: [PlatformController],
  providers: [PlatformService, BillingService],
})
export class PlatformModule {}
