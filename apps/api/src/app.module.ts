import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { EngineModule } from './engine/engine.module';
import { InvitesModule } from './invites/invites.module';
import { MeModule } from './memberships/me.module';
import { MembershipsModule } from './memberships/memberships.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [PrismaModule, EngineModule, AuthModule, MembershipsModule, MeModule, InvitesModule],
})
export class AppModule {}
