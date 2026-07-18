import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { clearRefreshCookie, isBrowserAuthRequest, readCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from './auth.browser';
import { ZodValidationPipe } from '../common/zod.pipe';
import { MfaExempt, Public } from './auth.guard';
import { CurrentUser } from './auth.guard';
import { RequestUser } from './auth.types';
import { AuthService, RequestMeta } from './auth.service';
import {
  loginMfaSchema,
  LoginMfaInput,
  loginSchema,
  LoginInput,
  mfaCodeSchema,
  MfaCodeInput,
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

function refreshCredential(req: Request, body: RefreshInput): string {
  const refreshToken = body.refreshToken ?? readCookie(req, REFRESH_COOKIE_NAME);
  if (!refreshToken) throw new UnauthorizedException('refresh token is required');
  return refreshToken;
}

// Hassas kimlik uclari: brute-force/spam'e karsi siki limit (IP bazli, dk'da 10).
// Global throttler tabani 120/dk; bu uclar daha sikidir (SPEC 10).
@Throttle({ default: { limit: 10, ttl: 60_000 } })
@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private browserSession(req: Request, res: Response, session: Awaited<ReturnType<AuthService['login']>>) {
    if (!('refreshToken' in session) || !isBrowserAuthRequest(req)) return session;
    setRefreshCookie(res, session.refreshToken);
    const { refreshToken: _refreshToken, ...publicSession } = session;
    return publicSession;
  }

  @Post('register-by-invite')
  async register(
    @Body(new ZodValidationPipe(registerByInviteSchema)) body: RegisterByInviteInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.registerByInvite(body, meta(req));
    return this.browserSession(req, res, session);
  }

  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.login(body, meta(req));
    return this.browserSession(req, res, session);
  }

  @HttpCode(200)
  @Post('login/2fa')
  async loginMfa(
    @Body(new ZodValidationPipe(loginMfaSchema)) body: LoginMfaInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.completeLoginMfa(body.challengeToken, body.code, meta(req));
    return this.browserSession(req, res, session);
  }

  @HttpCode(200)
  @Post('refresh')
  async refresh(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const session = await this.auth.refresh(refreshCredential(req, body), meta(req));
    return this.browserSession(req, res, session);
  }

  @HttpCode(200)
  @Post('logout')
  async logout(
    @Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.logout(refreshCredential(req, body));
    if (isBrowserAuthRequest(req)) clearRefreshCookie(res);
    return result;
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

@MfaExempt()
@Controller('auth/2fa')
export class MfaController {
  constructor(private readonly auth: AuthService) {}

  @Get('status')
  status(@CurrentUser() user: RequestUser) {
    return this.auth.mfaStatus(user.sub);
  }

  @HttpCode(200)
  @Post('setup')
  setup(@CurrentUser() user: RequestUser) {
    return this.auth.setupMfa(user.sub);
  }

  @HttpCode(200)
  @Post('enable')
  enable(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(mfaCodeSchema)) body: MfaCodeInput) {
    return this.auth.enableMfa(user.sub, body.code);
  }

  @HttpCode(200)
  @Post('disable')
  disable(@CurrentUser() user: RequestUser, @Body(new ZodValidationPipe(mfaCodeSchema)) body: MfaCodeInput) {
    return this.auth.disableMfa(user.sub, body.code);
  }
}

@Controller('auth/sessions')
export class SessionsController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  list(@CurrentUser() user: RequestUser) {
    return this.auth.listSessions(user.sub);
  }

  @HttpCode(200)
  @Delete(':id')
  revoke(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auth.revokeSession(user.sub, id);
  }

  @HttpCode(200)
  @Post('revoke-all')
  revokeAll(@CurrentUser() user: RequestUser) {
    return this.auth.revokeAllSessions(user.sub);
  }
}
