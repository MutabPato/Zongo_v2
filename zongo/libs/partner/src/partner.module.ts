import { Module } from '@nestjs/common';
import { PARTNER_PORT } from '@app/domain';
import type { PretiumClient } from './lib/pretium-adapter';
import { PretiumPartnerAdapter } from './lib/pretium-adapter.service';
import {
  PRETIUM_CLIENT,
  unavailablePretiumClient,
} from './lib/pretium-adapter';

@Module({
  providers: [
    { provide: PRETIUM_CLIENT, useValue: unavailablePretiumClient },
    {
      provide: PARTNER_PORT,
      useFactory: (client: PretiumClient) => new PretiumPartnerAdapter(client),
      inject: [PRETIUM_CLIENT],
    },
  ],
  exports: [PARTNER_PORT],
})
export class PartnerModule {}
