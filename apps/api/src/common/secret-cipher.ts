import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { decryptSecret, encryptionKeyFromEnv, encryptSecret } from './crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const SECRET_DECRYPTION_FAILED = 'secret decryption failed';

export interface SecretContext {
  purpose: 'user-totp' | 'payout-account';
  tenantId: string | null;
  recordId: string;
}

@Injectable()
export abstract class SecretCipher {
  abstract encrypt(plaintext: string, context: SecretContext): Promise<string>;
  abstract decrypt(envelope: string, context: SecretContext): Promise<string>;
}

/** Provider payload is deliberately opaque to the envelope layer (local AES today, KMS later). */
export abstract class SecretCryptoProvider {
  abstract readonly providerId: string;
  abstract activeKeyId(): Promise<string>;
  abstract seal(keyId: string, plaintext: Buffer, aad: Buffer): Promise<Buffer>;
  abstract open(keyId: string, payload: Buffer, aad: Buffer): Promise<Buffer>;
}

@Injectable()
export class EnvAesGcmSecretCryptoProvider extends SecretCryptoProvider {
  readonly providerId = 'env-aes-256-gcm';
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor() {
    super();
    // Construction is the production startup fail-fast boundary. This preserves the exact
    // REFEARN_ENC_KEY -> SHA-256 derivation used by the legacy helper.
    this.key = encryptionKeyFromEnv();
    this.keyId = createHash('sha256').update(this.key).digest('base64url').slice(0, 22);
  }

  async activeKeyId(): Promise<string> {
    return this.keyId;
  }

  async seal(keyId: string, plaintext: Buffer, aad: Buffer): Promise<Buffer> {
    this.assertActiveKey(keyId);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  }

  async open(keyId: string, payload: Buffer, aad: Buffer): Promise<Buffer> {
    this.assertActiveKey(keyId);
    if (payload.length < IV_BYTES + AUTH_TAG_BYTES) throw new Error('invalid provider payload');
    const iv = payload.subarray(0, IV_BYTES);
    const tag = payload.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
    const ciphertext = payload.subarray(IV_BYTES + AUTH_TAG_BYTES);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_BYTES });
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  private assertActiveKey(keyId: string): void {
    if (keyId !== this.keyId) throw new Error('unknown key');
  }
}

export class VersionedSecretCipher extends SecretCipher {
  private readonly providers: ReadonlyMap<string, SecretCryptoProvider>;
  private readonly activeProvider: SecretCryptoProvider;

  constructor(providerList: readonly SecretCryptoProvider[], private readonly writeVersion = 'legacy') {
    super();
    if (providerList.length === 0) throw new Error('at least one secret crypto provider is required');
    this.providers = new Map(providerList.map((provider) => [provider.providerId, provider]));
    if (this.providers.size !== providerList.length) throw new Error('duplicate secret crypto provider id');
    this.activeProvider = providerList[0];
  }

  async encrypt(plaintext: string, context: SecretContext): Promise<string> {
    if (this.writeVersion !== VERSION) {
      // Reader-first rollout: default legacy output remains readable by the previous binary.
      return encryptSecret(plaintext);
    }
    try {
      validateContext(context);
      const providerId = this.activeProvider.providerId;
      const keyId = await this.activeProvider.activeKeyId();
      const aad = canonicalAad(providerId, keyId, context);
      const payload = await this.activeProvider.seal(keyId, Buffer.from(plaintext, 'utf8'), aad);
      return [VERSION, encodeText(providerId), encodeText(keyId), payload.toString('base64url')].join('.');
    } catch {
      throw new Error('secret encryption failed');
    }
  }

  async decrypt(envelope: string, context: SecretContext): Promise<string> {
    try {
      validateContext(context);
      if (envelope.startsWith(`${VERSION}.`)) return await this.decryptV1(envelope, context);
      validateLegacyEnvelope(envelope);
      return decryptSecret(envelope);
    } catch {
      // Do not expose provider/key/context details, plaintext or ciphertext in error messages/logs.
      throw new Error(SECRET_DECRYPTION_FAILED);
    }
  }

  private async decryptV1(envelope: string, context: SecretContext): Promise<string> {
    const parts = envelope.split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('invalid envelope');
    const providerId = decodeText(parts[1]);
    const keyId = decodeText(parts[2]);
    const payload = decodeBase64Url(parts[3]);
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error('unknown provider');
    const aad = canonicalAad(providerId, keyId, context);
    return (await provider.open(keyId, payload, aad)).toString('utf8');
  }
}

function canonicalAad(providerId: string, keyId: string, context: SecretContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      scope: 'refearn-secret',
      version: 1,
      provider: providerId,
      keyId,
      purpose: context.purpose,
      tenantId: context.tenantId,
      recordId: context.recordId,
    }),
    'utf8',
  );
}

function validateContext(context: SecretContext): void {
  if (context.purpose !== 'user-totp' && context.purpose !== 'payout-account') throw new Error('invalid purpose');
  if (!context.recordId || (context.tenantId !== null && !context.tenantId)) throw new Error('invalid context');
}

function encodeText(value: string): string {
  if (!value) throw new Error('empty envelope identifier');
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decodeText(value: string): string {
  const decoded = decodeBase64Url(value).toString('utf8');
  if (!decoded) throw new Error('empty envelope identifier');
  return decoded;
}

function decodeBase64Url(value: string): Buffer {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('non-canonical base64url');
  return decoded;
}

function validateLegacyEnvelope(envelope: string): void {
  const parts = envelope.split('.');
  if (parts.length !== 3) throw new Error('invalid legacy envelope');
  const [iv, tag, ciphertext] = parts.map(decodeBase64);
  if (iv.length !== IV_BYTES || tag.length !== AUTH_TAG_BYTES || ciphertext.length === 0) {
    throw new Error('invalid legacy envelope');
  }
}

function decodeBase64(value: string): Buffer {
  if (!value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('invalid base64');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new Error('non-canonical base64');
  return decoded;
}
