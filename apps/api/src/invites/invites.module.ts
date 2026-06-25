import { Module } from '@nestjs/common';
import { AdminInviteFunnelController, AppInvitesController, PublicInvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  controllers: [PublicInvitesController, AppInvitesController, AdminInviteFunnelController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
