import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';

/** Opak token'lar (refresh, e-posta dogrulama) — DB'de yalnizca hash saklanir. */
export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Bilinen/zayif anahtar = at-rest sifre sahte guvenlik. Uretimde fail-fast (bkz. authConfig.accessSecret). */
const DEV_ENC_FALLBACK = 'refearn-dev-encryption-key-change-in-prod';

/** Simetrik sifreleme anahtari (32 bayt) — REFEARN_ENC_KEY'den turetilir. Uretimde zorunlu. */
function encKey(): Buffer {
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
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

export function decryptSecret(blob: string): string {
  const [ivB, tagB, encB] = blob.split('.');
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB, 'base64'));
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

/** memberships.path icin ltree-uyumlu etiket (uuid'deki '-' -> '_'). */
export function ltreeLabel(id: string): string {
  return id.replace(/-/g, '_');
}
