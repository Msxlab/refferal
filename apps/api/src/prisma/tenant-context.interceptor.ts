import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { RequestUser } from '../auth/auth.types';
import { TenantContextService } from './tenant-context.service';

@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  constructor(private readonly tenantContext: TenantContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = req.user;
    const store = {
      userId: user?.sub ?? null,
      tenantId: user?.tid ?? null,
      membershipId: user?.mid ?? null,
    };
    return new Observable((subscriber) =>
      this.tenantContext.run(store, () => {
        const sub = next.handle().subscribe({
          next: (value) => subscriber.next(value),
          error: (err) => subscriber.error(err),
          complete: () => subscriber.complete(),
        });
        return () => sub.unsubscribe();
      }),
    );
  }
}
