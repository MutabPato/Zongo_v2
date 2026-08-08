import { Module } from '@nestjs/common';
import { PARTNER_PORT } from '@app/domain';
import { PretiumHttpClient, type PretiumClient } from './lib/pretium-adapter';
import { PretiumPartnerAdapter } from './lib/pretium-adapter.service';
import {
  PRETIUM_CLIENT,
  unavailablePretiumClient,
} from './lib/pretium-adapter';
import {
  PretiumWebhookService,
  PretiumWebhookSignatureService,
} from './lib/pretium-webhook.service';
import { LedgerModule } from '@app/ledger';
import { DbModule } from '@app/db';
import { AuditModule } from '@app/audit';

@Module({
  imports: [DbModule, AuditModule, LedgerModule],
  providers: [
    PretiumWebhookService,
    PretiumWebhookSignatureService,
    {
      provide: PRETIUM_CLIENT,
      useFactory: (): PretiumClient =>
        process.env.PRETIUM_BASE_URL && process.env.PRETIUM_CONSUMER_KEY
          ? new PretiumHttpClient(
              process.env.PRETIUM_BASE_URL,
              process.env.PRETIUM_CONSUMER_KEY,
              process.env.PRETIUM_WEBHOOK_URL,
            )
          : unavailablePretiumClient,
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
