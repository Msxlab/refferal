import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

/** Opak token'lar (refresh, e-posta dogrulama) — DB'de yalnizca hash saklanir. */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function keyFromSecret(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

/** Small AES-GCM envelope for sensitive notification payload values. */
export function encryptSecret(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

export function decryptSecret(sealed: string, secret: string): string {
  const [version, ivRaw, tagRaw, ciphertextRaw] = sealed.split('.');
  if (version !== 'v1' || !ivRaw || !tagRaw || !ciphertextRaw) {
    throw new Error('invalid encrypted secret envelope');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFromSecret(secret), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
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
