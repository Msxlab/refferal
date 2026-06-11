import { Module } from '@nestjs/common';
import { MembersAdminController } from './members.admin.controller';
import { MembersAdminService } from './members.admin.service';

@Module({
  controllers: [MembersAdminController],
  providers: [MembersAdminService],
  exports: [MembersAdminService],
})
export class MembersAdminModule {}
