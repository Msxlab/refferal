import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { HealthModule } from '../health/health.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [EngineModule, HealthModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
