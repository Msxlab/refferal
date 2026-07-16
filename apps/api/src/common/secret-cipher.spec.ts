import { createHash, timingSafeEqual } from 'node:crypto';
import {
  EnvAesGcmSecretCryptoProvider,
  SecretContext,
  SecretCryptoProvider,
  VersionedSecretCipher,
} from './secret-cipher';

const TEST_KEY = 'unit-test-refearn-encryption-key-0001';
const LEGACY_FIXTURE = 'AAECAwQFBgcICQoL.npntZscVLpPZsZgOnd3dqw==.47NbmrLH9DPObHIbCJod/4w8';
const TOTP_CONTEXT: SecretContext = {
  purpose: 'user-totp',
  tenantId: null,
  recordId: '10000000-0000-0000-0000-000000000001',
};

const originalNodeEnv = process.env.NODE_ENV;
const originalEncryptionKey = process.env.REFEARN_ENC_KEY;

function restore(name: 'NODE_ENV' | 'REFEARN_ENC_KEY', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function realCipher(writeVersion = 'v1'): VersionedSecretCipher {
  const provider = new EnvAesGcmSecretCryptoProvider();
  return new VersionedSecretCipher([provider], writeVersion);
}

class FakeOpaqueProvider extends SecretCryptoProvider {
  constructor(readonly providerId: string, private readonly keyId: string) {
    super();
  }

  async activeKeyId(): Promise<string> {
    return this.keyId;
  }

  async seal(keyId: string, plaintext: Buffer, aad: Buffer): Promise<Buffer> {
    if (keyId !== this.keyId) throw new Error('unknown fake key');
    const binding = createHash('sha256').update(aad).digest();
    return Buffer.concat([binding, Buffer.from(plaintext).reverse()]);
  }

  async open(keyId: string, payload: Buffer, aad: Buffer): Promise<Buffer> {
    if (keyId !== this.keyId || payload.length < 32) throw new Error('fake open failed');
    const expected = createHash('sha256').update(aad).digest();
    const actual = payload.subarray(0, 32);
    if (!timingSafeEqual(actual, expected)) throw new Error('fake aad mismatch');
    return Buffer.from(payload.subarray(32)).reverse();
  }
}

describe('VersionedSecretCipher', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.REFEARN_ENC_KEY = TEST_KEY;
  });

  afterAll(() => {
    restore('NODE_ENV', originalNodeEnv);
    restore('REFEARN_ENC_KEY', originalEncryptionKey);
  });

  it('writes a v1 envelope and opens it with the same context', async () => {
    const cipher = realCipher();

    const envelope = await cipher.encrypt('TOTP-SECRET', TOTP_CONTEXT);

    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    await expect(cipher.decrypt(envelope, TOTP_CONTEXT)).resolves.toBe('TOTP-SECRET');
  });

  it.each(['vI', 'v1 ', 'v2', ''])('fails fast for the invalid write version %j', (writeVersion) => {
    const provider = new EnvAesGcmSecretCryptoProvider();

    expect(() => new VersionedSecretCipher([provider], writeVersion)).toThrow('invalid secret write version');
  });

  it('does not echo a sensitive invalid write version in the failure', () => {
    const provider = new EnvAesGcmSecretCryptoProvider();
    const sensitiveInvalidVersion = 'v1 SENSITIVE-WRITE-GATE';

    expect(() => new VersionedSecretCipher([provider], sensitiveInvalidVersion)).toThrow(
      new Error('invalid secret write version'),
    );
  });

  it.each([
    ['purpose', { ...TOTP_CONTEXT, purpose: 'payout-account' as const }],
    ['tenant', { ...TOTP_CONTEXT, tenantId: '20000000-0000-0000-0000-000000000001' }],
    ['record', { ...TOTP_CONTEXT, recordId: '30000000-0000-0000-0000-000000000001' }],
  ])('rejects a %s context mismatch with one normalized error', async (_label, wrongContext) => {
    const cipher = realCipher();
    const envelope = await cipher.encrypt('TOTP-SECRET', TOTP_CONTEXT);

    await expect(cipher.decrypt(envelope, wrongContext)).rejects.toThrow('secret decryption failed');
  });

  it('never downgrades a malformed v1 envelope to the legacy reader', async () => {
    await expect(realCipher().decrypt('v1.invalid.invalid', TOTP_CONTEXT)).rejects.toThrow(
      'secret decryption failed',
    );
  });

  it('normalizes unknown provider and key failures', async () => {
    const cipher = realCipher();
    const envelope = await cipher.encrypt('TOTP-SECRET', TOTP_CONTEXT);
    const [, provider, keyId, payload] = envelope.split('.');

    await expect(
      cipher.decrypt(`v1.${Buffer.from('unknown-provider').toString('base64url')}.${keyId}.${payload}`, TOTP_CONTEXT),
    ).rejects.toThrow('secret decryption failed');
    await expect(
      cipher.decrypt(`v1.${provider}.${Buffer.from('unknown-key').toString('base64url')}.${payload}`, TOTP_CONTEXT),
    ).rejects.toThrow('secret decryption failed');
  });

  it('opens an existing three-part AES-GCM legacy fixture', async () => {
    await expect(realCipher().decrypt(LEGACY_FIXTURE, TOTP_CONTEXT)).resolves.toBe('LEGACY-TOTP-SECRET');
  });

  it.each([
    ['missing', undefined],
    ['known development fallback', 'refearn-dev-encryption-key-change-in-prod'],
    ['short', 'too-short'],
  ])('fails provider construction in production for a %s key', (_label, key) => {
    process.env.NODE_ENV = 'production';
    if (key === undefined) delete process.env.REFEARN_ENC_KEY;
    else process.env.REFEARN_ENC_KEY = key;

    expect(() => new EnvAesGcmSecretCryptoProvider()).toThrow('REFEARN_ENC_KEY');
  });

  it('routes opaque envelopes to the provider named by the envelope', async () => {
    const current = new FakeOpaqueProvider('fake-current', 'current-key');
    const archived = new FakeOpaqueProvider('fake-archived', 'archived-key');
    const archivedWriter = new VersionedSecretCipher([archived], 'v1');
    const multiProviderReader = new VersionedSecretCipher([current, archived], 'v1');

    const envelope = await archivedWriter.encrypt('OPAQUE-SECRET', TOTP_CONTEXT);

    await expect(multiProviderReader.decrypt(envelope, TOTP_CONTEXT)).resolves.toBe('OPAQUE-SECRET');
  });
});
