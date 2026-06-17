import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AccountService } from './account.service';
import {
  changePasswordSchema,
  ChangePasswordInput,
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
}
