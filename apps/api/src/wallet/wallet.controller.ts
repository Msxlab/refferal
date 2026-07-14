import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, RequireMembership } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { ZodValidationPipe } from '../common/zod.pipe';
import { WalletService } from './wallet.service';
import { dashboardQuerySchema, DashboardQuery, walletQuerySchema, WalletQuery } from './wallet.types';

/** Member surface (/app). Requires an active membership and only returns the caller's own data. */
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

  @Get('brand')
  brand(@CurrentUser() user: RequestUser) {
    return this.wallet.brand(user.tid as string);
  }

  @Get('wallet')
  walletView(@CurrentUser() user: RequestUser, @Query(new ZodValidationPipe(walletQuerySchema)) q: WalletQuery) {
    return this.wallet.wallet(user.mid as string, user.tid as string, q);
  }

  @Get('team')
  team(@CurrentUser() user: RequestUser) {
    return this.wallet.team(user.mid as string, user.tid as string);
  }
}
