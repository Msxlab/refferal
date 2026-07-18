/**
 * Request actor context derived from JWT claims.
 * Passed into services that need to write audit records. It lives in common to avoid
 * creating dependencies between leaf modules.
 */
export interface ActorContext {
  userId: string;
  tenantId: string;
}
