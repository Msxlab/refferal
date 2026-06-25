import { ForbiddenException, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { ActorContext } from '../common/actor';

export interface TenantContextStore {
  userId: string | null;
  tenantId: string | null;
  membershipId: string | null;
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContextStore>();

  run<T>(store: TenantContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  get(): TenantContextStore | undefined {
    return this.storage.getStore();
  }

  tenantId(): string | null {
    return this.get()?.tenantId ?? null;
  }

  assertTenant(tenantId: string): void {
    const current = this.tenantId();
    if (current && current !== tenantId) {
      throw new ForbiddenException('tenant context mismatch');
    }
  }

  assertMembership(membershipId: string): void {
    const current = this.get()?.membershipId ?? null;
    if (current && current !== membershipId) {
      throw new ForbiddenException('membership context mismatch');
    }
  }

  assertActor(actor: ActorContext): void {
    const current = this.get();
    if (!current) return;
    if (current.userId && current.userId !== actor.userId) {
      throw new ForbiddenException('actor context mismatch');
    }
    this.assertTenant(actor.tenantId);
  }
}
