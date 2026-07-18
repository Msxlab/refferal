import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

/** Opaque tokens for refresh and email verification; only hashes are stored in DB. */
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
function encryptSecretWithKey(value: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptSecretWithKey(sealed: string, secret: string): string {
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

/** Bilinen/zayif anahtar = at-rest sifre sahte guvenlik. Uretimde fail-fast (bkz. authConfig.accessSecret). */
const DEV_ENC_FALLBACK = 'refearn-dev-encryption-key-change-in-prod';

/** Simetrik sifreleme anahtari (32 bayt) — REFEARN_ENC_KEY'den turetilir. Uretimde zorunlu. */
export function encryptionKeyFromEnv(): Buffer {
  const key = process.env.REFEARN_ENC_KEY;
  if (process.env.NODE_ENV === 'production') {
    // Banka hesap no gibi veri bilinen anahtarla sifrelenirse DB/yedek sizintisi = aninda cozulur.
    if (!key || key === DEV_ENC_FALLBACK) {
      throw new Error('REFEARN_ENC_KEY tanimli degil veya dev-fallback (uretimde zorunlu, en az 32 karakter)');
    }
    if (key.length < 32) {
      throw new Error('REFEARN_ENC_KEY en az 32 karakter olmali (uretim)');
    }
  }
  return createHash('sha256').update(key ?? DEV_ENC_FALLBACK).digest();
}

/**
 * AES-256-GCM ile hassas veri sifreleme (self-hosted: banka hesap no gibi).
 * Cikti: iv.tag.ciphertext (base64), tek string. At-rest sifreli; dis servis YOK.
 */
/**
 * Encrypt a secret with either an explicit context key (notification payloads) or the
 * at-rest environment key (legacy payout ciphertext / SecretCipher compatibility).
 */
export function encryptSecret(plain: string, secret?: string): string {
  if (secret) return encryptSecretWithKey(plain, secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKeyFromEnv(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(blob: string, secret?: string): string {
  if (secret) return decryptSecretWithKey(blob, secret);
  const [ivB, tagB, encB] = blob.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKeyFromEnv(), Buffer.from(ivB, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB, 'base64')), decipher.final()]).toString('utf8');
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

/** ltree-compatible label for memberships.path by replacing UUID hyphens with underscores. */
export function ltreeLabel(id: string): string {
  return id.replace(/-/g, '_');
}
