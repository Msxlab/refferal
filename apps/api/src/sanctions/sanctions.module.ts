import { Module } from '@nestjs/common';
import { SanctionsController } from './sanctions.controller';
import { SanctionsService } from './sanctions.service';

@Module({
  controllers: [SanctionsController],
  providers: [SanctionsService],
  exports: [SanctionsService],
})
export class SanctionsModule {}
