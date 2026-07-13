import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { ApiService } from './api.service';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '@app/audit';
import { DbModule } from '@app/db';
import { DomainModule } from '@app/domain';
import { PartnerModule } from '@app/partner';
import { ProfileModule } from '@app/profile';
import { BeneficiaryModule } from '@app/beneficiary';
import { WhatsappModule } from '@app/whatsapp';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DomainModule,
    PartnerModule,
    ProfileModule,
    BeneficiaryModule,
    WhatsappModule,
    AuditModule,
    DbModule,
  ],
  controllers: [ApiController],
  providers: [ApiService],
})
export class ApiModule {}
