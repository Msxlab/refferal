import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MembersAdminController } from './members.admin.controller';
import { MembersAdminService } from './members.admin.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [MembersAdminController],
  providers: [MembersAdminService],
  exports: [MembersAdminService],
})
export class MembersAdminModule {}
