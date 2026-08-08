import { Global, Module } from '@nestjs/common';
import {
  ENVELOPE_ENCRYPTION,
  EnvelopeEncryptionService,
  EnvironmentKeyProvider,
} from './security.service';

@Global()
@Module({
  providers: [
    EnvironmentKeyProvider,
    {
      provide: ENVELOPE_ENCRYPTION,
      useFactory: (keys: EnvironmentKeyProvider) =>
        new EnvelopeEncryptionService(keys),
      inject: [EnvironmentKeyProvider],
    },
  ],
  exports: [ENVELOPE_ENCRYPTION],
})
export class SecurityModule {}
