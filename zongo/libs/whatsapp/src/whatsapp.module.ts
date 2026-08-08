import { Module } from '@nestjs/common';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { SecurityModule } from '@app/security';
import {
  WhatsAppSessionService,
  WhatsAppWebhookSignatureService,
  MetaWhatsAppNotifier,
  WHATSAPP_NOTIFIER,
  unavailableWhatsAppNotifier,
} from './whatsapp.service';
import { WhatsAppIngressThrottleService } from './whatsapp-ingress-throttle.service';

@Module({
  imports: [DbModule, AuditModule, SecurityModule],
  providers: [
    WhatsAppSessionService,
    WhatsAppWebhookSignatureService,
    WhatsAppIngressThrottleService,
    {
      provide: WHATSAPP_NOTIFIER,
      useFactory: () =>
        process.env.META_WHATSAPP_PHONE_NUMBER_ID &&
        process.env.META_WHATSAPP_ACCESS_TOKEN
          ? new MetaWhatsAppNotifier(
              process.env.META_WHATSAPP_PHONE_NUMBER_ID,
              process.env.META_WHATSAPP_ACCESS_TOKEN,
            )
          : unavailableWhatsAppNotifier,
    },
  ],
  exports: [
    WhatsAppSessionService,
    WhatsAppWebhookSignatureService,
    WhatsAppIngressThrottleService,
    WHATSAPP_NOTIFIER,
  ],
})
export class WhatsAppModule {}
