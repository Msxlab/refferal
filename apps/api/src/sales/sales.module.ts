import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { AppSalesController, SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [EngineModule],
  controllers: [SalesController, AppSalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
