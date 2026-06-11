import { createHash, randomBytes, randomUUID } from 'node:crypto';

/** Opak token'lar (refresh, e-posta dogrulama) — DB'de yalnizca hash saklanir. */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Okunakli kod alfabesi: 0/O/1/I karisikligi yok (davet + referral kodlari). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export function newUuid(): string {
  return randomUUID();
}

/** memberships.path icin ltree-uyumlu etiket (uuid'deki '-' -> '_'). */
export function ltreeLabel(id: string): string {
  return id.replace(/-/g, '_');
}
