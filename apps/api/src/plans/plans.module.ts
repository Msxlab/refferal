import { Module } from '@nestjs/common';
import { AppPlansController, PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  controllers: [PlansController, AppPlansController],
  providers: [PlansService],
})
export class PlansModule {}
