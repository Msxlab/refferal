import { createHmac } from 'node:crypto';

type FingerprintKind = 'email' | 'ip';

function derivedAuditKey(secret: string): Buffer {
  return createHmac('sha256', secret).update('refearn:audit-redaction:v1').digest();
}

/** A domain-separated HMAC for correlation without retaining the raw PII value. */
export function auditFingerprint(value: string | undefined, kind: FingerprintKind, secret: string): string | undefined {
  const normalized = kind === 'email' ? value?.trim().toLowerCase() : value?.trim();
  if (!normalized) return undefined;
  return createHmac('sha256', derivedAuditKey(secret))
    .update(`${kind}:${normalized}`)
    .digest('hex');
}
