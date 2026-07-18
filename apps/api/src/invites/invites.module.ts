import { Module } from '@nestjs/common';
import {
  AppInvitesController,
  InviteContinuationsController,
  PublicInvitesController,
} from './invites.controller';
import { AdminInviteFunnelController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  controllers: [PublicInvitesController, InviteContinuationsController, AppInvitesController, AdminInviteFunnelController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
