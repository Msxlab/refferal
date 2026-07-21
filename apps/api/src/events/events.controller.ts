import { Controller, MessageEvent, Sse } from '@nestjs/common';
import { MembershipStatus, Role, TenantStatus } from '@prisma/client';
import { Observable, from, of, timer } from 'rxjs';
import { catchError, concatMap, exhaustMap, filter, map, take, takeUntil } from 'rxjs/operators';
import { CurrentUser, RequireMembership, Roles } from '../auth/auth.guard';
import { RequestUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { EventsService } from './events.service';

/**
 * Bearer-authenticated Server-Sent Events.
 * Only tenant owners/admins can subscribe; the stream fails closed after a
 * membership, tenant-status, role, or session-generation change.
 */
const AUTHORIZATION_REVALIDATION_MS = 15_000;

@RequireMembership()
@Roles(Role.tenant_owner, Role.tenant_admin)
@Controller('events')
export class EventsController {
  constructor(
    private readonly events: EventsService,
    private readonly prisma: PrismaService,
  ) {}

  @Sse('stream')
  stream(@CurrentUser() payload: RequestUser): Observable<MessageEvent> {
    const authorizationRevoked = timer(AUTHORIZATION_REVALIDATION_MS, AUTHORIZATION_REVALIDATION_MS).pipe(
      exhaustMap(() => from(this.stillAuthorized(payload)).pipe(catchError(() => of(false)))),
      filter((authorized) => !authorized),
      take(1),
    );

    return this.events.stream().pipe(
      filter((event) => event.tenantId === payload.tid),
      // Before every event, verify the live membership and session generation.
      // Query failures are deliberately treated as authorization failures.
      concatMap((event) => from(this.stillAuthorized(payload)).pipe(
        catchError(() => of(false)),
        filter((authorized) => authorized),
        map(() => ({ type: event.event, data: event.data }) as MessageEvent),
      )),
      // An idle stream cannot outlive a revoked principal indefinitely.
      takeUntil(authorizationRevoked),
    );
  }

  private async stillAuthorized(payload: RequestUser): Promise<boolean> {
    if (!payload.tid || !payload.mid || !payload.sub || payload.authGeneration === undefined) {
      return false;
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: payload.mid,
        userId: payload.sub,
        tenantId: payload.tid,
        status: MembershipStatus.active,
        role: { in: [Role.tenant_owner, Role.tenant_admin] },
        tenant: { status: TenantStatus.active },
      },
      select: { user: { select: { authGeneration: true } } },
    });

    return membership?.user.authGeneration === payload.authGeneration;
  }
}
