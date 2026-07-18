import { Module } from '@nestjs/common';
import { BackgroundJobStatusService } from './background-job-status.service';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics.controller';

@Module({
  controllers: [HealthController, MetricsController],
  providers: [BackgroundJobStatusService],
  exports: [BackgroundJobStatusService],
})
export class HealthModule {}
