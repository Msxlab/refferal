import { Global, Module } from '@nestjs/common';
import {
  EnvAesGcmSecretCryptoProvider,
  SecretCipher,
  VersionedSecretCipher,
} from './secret-cipher';

@Global()
@Module({
  providers: [
    EnvAesGcmSecretCryptoProvider,
    {
      provide: SecretCipher,
      inject: [EnvAesGcmSecretCryptoProvider],
      useFactory: (provider: EnvAesGcmSecretCryptoProvider): SecretCipher =>
        new VersionedSecretCipher([provider], process.env.REFEARN_SECRET_WRITE_VERSION ?? 'legacy'),
    },
  ],
  exports: [SecretCipher],
})
export class SecretsModule {}
