import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { ZodValidationPipe } from '../common/zod.pipe';
import { Public } from './auth.guard';
import { AuthService, RequestMeta } from './auth.service';
import {
  loginSchema,
  LoginInput,
  passwordResetConfirmSchema,
  PasswordResetConfirmInput,
  passwordResetRequestSchema,
  PasswordResetRequestInput,
  refreshSchema,
  RefreshInput,
  registerByInviteSchema,
  RegisterByInviteInput,
  verifyEmailSchema,
  VerifyEmailInput,
} from './auth.types';

function meta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.headers['user-agent']?.slice(0, 255) };
}

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register-by-invite')
  register(
    @Body(new ZodValidationPipe(registerByInviteSchema)) body: RegisterByInviteInput,
    @Req() req: Request,
  ) {
    return this.auth.registerByInvite(body, meta(req));
  }

  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput, @Req() req: Request) {
    return this.auth.login(body, meta(req));
  }

  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput, @Req() req: Request) {
    return this.auth.refresh(body.refreshToken, meta(req));
  }

  @HttpCode(200)
  @Post('logout')
  logout(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    return this.auth.logout(body.refreshToken);
  }

  @HttpCode(200)
  @Post('verify-email')
  verifyEmail(@Body(new ZodValidationPipe(verifyEmailSchema)) body: VerifyEmailInput) {
    return this.auth.verifyEmail(body.token);
  }

  @HttpCode(200)
  @Post('password-reset/request')
  requestReset(@Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequestInput) {
    return this.auth.requestPasswordReset(body.email);
  }

  @HttpCode(200)
  @Post('password-reset/confirm')
  confirmReset(@Body(new ZodValidationPipe(passwordResetConfirmSchema)) body: PasswordResetConfirmInput) {
    return this.auth.confirmPasswordReset(body.token, body.newPassword);
  }
}
