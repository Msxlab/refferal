import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { MembershipsModule } from '../memberships/memberships.module';
import { AuthController, MfaController, SessionsController } from './auth.controller';
import { AccessTokenGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  imports: [JwtModule.register({}), MembershipsModule],
  controllers: [AuthController, MfaController, SessionsController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AccessTokenGuard }],
  exports: [AuthService],
})
export class AuthModule {}
