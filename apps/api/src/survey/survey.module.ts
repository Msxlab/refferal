import { Module } from '@nestjs/common';
import { AdminSurveyController, AppSurveyController } from './survey.controller';
import { SurveyService } from './survey.service';

@Module({
  controllers: [AppSurveyController, AdminSurveyController],
  providers: [SurveyService],
})
export class SurveyModule {}
