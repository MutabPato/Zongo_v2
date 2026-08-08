import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { HealthController } from './health.controller';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { DomainModule } from '@app/domain';
import { PartnerModule } from '@app/partner';
import { ProfileModule } from '@app/profile';
import { BeneficiaryModule } from '@app/beneficiary';
import { LedgerModule } from '@app/ledger';
import { WhatsAppModule } from '@app/whatsapp';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { TransferModule } from '@app/transfer';
import { PretiumWebhookController } from './pretium-webhook.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DomainModule,
    PartnerModule,
    ProfileModule,
    BeneficiaryModule,
    LedgerModule,
    AuditModule,
    DbModule,
    WhatsAppModule,
    TransferModule,
  ],
  controllers: [
    ApiController,
    HealthController,
    WhatsAppWebhookController,
    PretiumWebhookController,
  ],
  providers: [ApiService],
})
export class ApiModule {}
