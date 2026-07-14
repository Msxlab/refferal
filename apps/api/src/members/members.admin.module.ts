import { Module } from '@nestjs/common';
import { InvitesModule } from '../invites/invites.module';
import { MembersAdminController } from './members.admin.controller';
import { MembersAdminService } from './members.admin.service';

@Module({
  imports: [InvitesModule],
  controllers: [MembersAdminController],
  providers: [MembersAdminService],
  exports: [MembersAdminService],
})
export class MembersAdminModule {}
