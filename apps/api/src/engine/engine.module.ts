import { Module } from '@nestjs/common';
import { RanksModule } from '../ranks/ranks.module';
import { EngineService } from './engine.service';

@Module({
  imports: [RanksModule],
  providers: [EngineService],
  exports: [EngineService],
})
export class EngineModule {}
