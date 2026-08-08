import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { SecurityModule } from '@app/security';
import {
  WhatsAppSessionService,
  WhatsAppWebhookSignatureService,
  WHATSAPP_NOTIFIER,
  unavailableWhatsAppNotifier,
} from './whatsapp.service';

@Module({
  imports: [DbModule, AuditModule, SecurityModule],
  providers: [
    WhatsAppSessionService,
    WhatsAppWebhookSignatureService,
    { provide: WHATSAPP_NOTIFIER, useValue: unavailableWhatsAppNotifier },
  ],
  exports: [
    WhatsAppSessionService,
    WhatsAppWebhookSignatureService,
    WHATSAPP_NOTIFIER,
  ],
})
export class WhatsAppModule {}
