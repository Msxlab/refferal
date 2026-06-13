import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MembersAdminController } from './members.admin.controller';
import { MembersAdminService } from './members.admin.service';
import { MembershipsModule } from '../memberships/memberships.module';

@Module({
  imports: [JwtModule.register({}), MembershipsModule],
  controllers: [MembersAdminController],
  providers: [MembersAdminService],
  exports: [MembersAdminService],
})
export class MembersAdminModule {}
