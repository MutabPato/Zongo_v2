import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { DomainModule } from '@app/domain';
import { PartnerModule } from '@app/partner';
import {
  WhatsappTransferService,
  WHATSAPP_MESSENGER,
  type WhatsappMessengerPort,
} from './whatsapp-transfer.service';

const noOpMessenger: WhatsappMessengerPort = { send: () => Promise.resolve() };

@Module({
  imports: [DbModule, DomainModule, AuditModule, PartnerModule],
  providers: [
    WhatsappTransferService,
    { provide: WHATSAPP_MESSENGER, useValue: noOpMessenger },
  ],
  exports: [WhatsappTransferService, WHATSAPP_MESSENGER],
})
export class WhatsappModule {}
