import { Global, Module } from '@nestjs/common';
import { PeriodsController } from './periods.controller';
import { PeriodsService } from './periods.service';

/** Global: isLocked/list her yerden kullanilabilir (engine kendi tx-ici kontrolunu yapar). */
@Global()
@Module({
  controllers: [PeriodsController],
  providers: [PeriodsService],
  exports: [PeriodsService],
})
export class PeriodsModule {}
