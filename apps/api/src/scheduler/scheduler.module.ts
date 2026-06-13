import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { FraudModule } from '../fraud/fraud.module';
import { ReportsModule } from '../reports/reports.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [EngineModule, ReportsModule, FraudModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
