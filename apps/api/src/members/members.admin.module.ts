import { Module } from "@nestjs/common";
import { InvitesModule } from "../invites/invites.module";
import { JwtModule } from "@nestjs/jwt";
import { MembersAdminController } from "./members.admin.controller";
import { MembersAdminService } from "./members.admin.service";
import { MembershipsModule } from "../memberships/memberships.module";
import { NetworkHierarchyModule } from "./network-hierarchy.module";

@Module({
  imports: [
    InvitesModule,
    JwtModule.register({}),
    MembershipsModule,
    NetworkHierarchyModule,
  ],
  controllers: [MembersAdminController],
  providers: [MembersAdminService],
  exports: [MembersAdminService],
})
export class MembersAdminModule {}
