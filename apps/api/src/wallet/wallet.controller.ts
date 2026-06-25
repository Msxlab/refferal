import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequireMembership } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { WalletService } from './wallet.service';
import {
  dashboardQuerySchema,
  DashboardQuery,
  earningsQuerySchema,
  EarningsQuery,
  walletQuerySchema,
  WalletQuery,
} from './wallet.types';

/** Uye yuzeyi (/app). Aktif uyelik gerekli; her zaman KENDI verisini doner. */
@RequireMembership()
@Controller('app')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  @Get('dashboard')
  dashboard(
    @CurrentUser() user: RequestUser,
    @Query(new ZodValidationPipe(dashboardQuerySchema)) q: DashboardQuery,
  ) {
    return this.wallet.dashboard(user.mid as string, user.tid as string, q.month);
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
