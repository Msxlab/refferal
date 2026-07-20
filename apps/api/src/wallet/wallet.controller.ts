import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CurrentUser, RequireMembership } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ActorContext } from '../common/actor';
import { ZodValidationPipe } from '../common/zod.pipe';
import { WalletService } from './wallet.service';
import {
  dashboardQuerySchema,
  DashboardQuery,
  earningsQuerySchema,
  EarningsQuery,
  memberTreeChildrenQuerySchema,
  MemberTreeChildrenQuery,
  memberTreeDirectSearchSchema,
  MemberTreeDirectSearchInput,
  walletQuerySchema,
  WalletQuery,
} from './wallet.types';

/** Member surface (/app). Requires an active membership and only returns the caller's own data. */
@RequireMembership()
@Controller('app')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  private actor(user: RequestUser): ActorContext {
    return { userId: user.sub, tenantId: user.tid as string };
  }

  @Get('dashboard')
  dashboard(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) q: DashboardQuery,
  ) {
    return this.wallet.dashboard(user.mid as string, user.tid as string, q.month);
  }

  @Get('brand')
  brand(@CurrentUser() user: RequestUser) {
    return this.wallet.brand(user.tid as string);
  }

  @Get('wallet')
  walletView(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(walletQuerySchema)) q: WalletQuery) {
    return this.wallet.wallet(user.mid as string, user.tid as string, q);
  }

  /** Aylik kazanc serisi (grafik icin) — son N ay, eskiden yeniye. */
  @Get('earnings')
  earnings(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(earningsQuerySchema)) q: EarningsQuery,
  ) {
    return this.wallet.earnings(user.mid as string, user.tid as string, q.months);
  }

  // Keep all static hierarchy routes before the legacy `team` endpoint.
  @Get('team/tree')
  teamTree(@CurrentUser() user: RequestUser) {
    return this.wallet.teamTree(this.actor(user), user.mid as string);
  }

  @Get('team/tree/children')
  teamTreeChildren(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(memberTreeChildrenQuerySchema))
    query: MemberTreeChildrenQuery,
  ) {
    return this.wallet.teamTreeChildren(
      this.actor(user),
      user.mid as string,
      query,
    );
  }

  @HttpCode(200)
  @Post('team/tree/direct-search')
  teamTreeDirectSearch(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(memberTreeDirectSearchSchema))
    body: MemberTreeDirectSearchInput,
  ) {
    return this.wallet.teamTreeDirectSearch(
      this.actor(user),
      user.mid as string,
      body,
    );
  }

  @Get('team')
  team(@CurrentUser() user: RequestUser) {
    return this.wallet.team(user.mid as string, user.tid as string);
  }

  /** Direkt recruit'ler (1. seviye): isim + bu-ay aktivite + nudge sinyali. Gizlilik: yalniz kendi davet ettikleri. */
  @Get('team/recruits')
  recruits(@CurrentUser() user: RequestUser) {
    return this.wallet.recruits(user.mid as string, user.tid as string);
  }

  /** Gizlilik-uyumlu liderlik: yalniz kendi sirasi + yuzdelik dilim. */
  @Get('leaderboard')
  leaderboard(@CurrentUser() user: RequestUser) {
    return this.wallet.leaderboard(user.mid as string, user.tid as string);
  }

  /** Aktivasyon checklist'i. */
  @Get('onboarding')
  onboarding(@CurrentUser() user: RequestUser) {
    return this.wallet.onboarding(user.mid as string, user.sub, user.tid as string);
  }
}
