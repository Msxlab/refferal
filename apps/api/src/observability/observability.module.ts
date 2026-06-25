import { Global, Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';

/** Gozlemlenebilirlik (Faz B): kritik alarm kanali. Global — her modul AlertsService inject edebilir. */
@Global()
@Module({
  providers: [AlertsService],
  exports: [AlertsService],
})
export class ObservabilityModule {}
