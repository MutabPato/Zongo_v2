import { Module } from '@nestjs/common';
import { PARTNER_PORT } from '@app/domain';
import { createPretiumClient, type PretiumClient } from './lib/pretium-adapter';
import { PretiumPartnerAdapter } from './lib/pretium-adapter.service';
import { PRETIUM_CLIENT } from './lib/pretium-adapter';
import {
  PretiumWebhookService,
  PretiumWebhookSignatureService,
} from './lib/pretium-webhook.service';
import { LedgerModule } from '@app/ledger';
import { DbModule } from '@app/db';
import { AuditModule } from '@app/audit';
import { SecurityModule } from '@app/security';

@Module({
  imports: [DbModule, AuditModule, LedgerModule, SecurityModule],
  providers: [
    PretiumWebhookService,
    PretiumWebhookSignatureService,
    {
      provide: PRETIUM_CLIENT,
      useFactory: (): PretiumClient => createPretiumClient(process.env),
    },
    {
      provide: PARTNER_PORT,
      useFactory: (client: PretiumClient) => new PretiumPartnerAdapter(client),
      inject: [PRETIUM_CLIENT],
    },
  ],
  exports: [
    PARTNER_PORT,
    PretiumWebhookService,
    PretiumWebhookSignatureService,
  ],
})
export class PartnerModule {}
