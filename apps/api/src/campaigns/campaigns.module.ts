import { Module } from '@nestjs/common';
import { EngineModule } from '../engine/engine.module';
import { AppCampaignsController, CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [EngineModule],
  controllers: [CampaignsController, AppCampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
