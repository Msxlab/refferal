import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AccountService } from './account.service';
import {
  changePasswordSchema,
  ChangePasswordInput,
  disable2faSchema,
  Disable2faInput,
  enable2faSchema,
  Enable2faInput,
  updateProfileSchema,
  UpdateProfileInput,
} from './account.types';

/**
 * Kullanici kendi hesabi. @Public YOK + @RequireMembership YOK -> yalnizca authenticated
 * (gecerli access token). Principal user.sub. Impersonation'da yazma guard'da zaten bloke.
 * NOT: base path 'account' — mevcut me.controller (@Controller('me')) ile cakismaz.
 */
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Get()
  me(@CurrentUser() user: RequestUser) {
    return this.account.me(user.sub);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.account.updateProfile(user.sub, body);
  }

  @HttpCode(200)
  @Post('password')
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput,
  ) {
    return this.account.changePassword(user.sub, body);
  }

  // ---- 2FA (TOTP) ----

  @HttpCode(200)
  @Post('2fa/setup')
  setup2fa(@CurrentUser() user: RequestUser) {
    return this.account.setup2fa(user.sub);
  }

  @HttpCode(200)
  @Post('2fa/enable')
  enable2fa(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(enable2faSchema)) body: Enable2faInput,
  ) {
    return this.account.enable2fa(user.sub, body);
  }

  @HttpCode(200)
  @Post('2fa/disable')
  disable2fa(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(disable2faSchema)) body: Disable2faInput,
  ) {
    return this.account.disable2fa(user.sub, body);
  }

  // ---- Aktif oturumlar ----

  @Get('sessions')
  sessions(@CurrentUser() user: RequestUser) {
    return this.account.listSessions(user.sub, user.sid);
  }

  @HttpCode(200)
  @Post('sessions/revoke-others')
  revokeOthers(@CurrentUser() user: RequestUser) {
    return this.account.revokeOtherSessions(user.sub, user.sid);
  }

  @Delete('sessions/:id')
  revokeSession(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.revokeSession(user.sub, id);
  }
}
