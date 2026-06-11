import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [EngineModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
