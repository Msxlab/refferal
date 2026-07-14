import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import {
  AdminRecommendationsController,
  AppRecommendationsController,
  PlatformRecommendationsController,
} from './recommendations.controller';
import { RecommendationsService } from './recommendations.service';

@Module({
  imports: [WalletModule],
  controllers: [AppRecommendationsController, AdminRecommendationsController, PlatformRecommendationsController],
  providers: [RecommendationsService],
  exports: [RecommendationsService],
})
export class RecommendationsModule {}
