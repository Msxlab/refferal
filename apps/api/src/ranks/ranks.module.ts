import { Module } from '@nestjs/common';
import { AppRankController, RanksController } from './ranks.controller';
import { RanksService } from './ranks.service';

@Module({
  controllers: [RanksController, AppRankController],
  providers: [RanksService],
})
export class RanksModule {}
