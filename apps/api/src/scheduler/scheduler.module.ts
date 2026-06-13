import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { ReportsModule } from '../reports/reports.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [EngineModule, ReportsModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
