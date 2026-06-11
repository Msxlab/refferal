import { Module } from '@nestjs/common';
import { AppInvitesController, PublicInvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  controllers: [PublicInvitesController, AppInvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}
