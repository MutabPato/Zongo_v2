import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiService } from './api.service';
import { WhatsappTransferService } from '@app/whatsapp';

@Controller()
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    private readonly whatsapp: WhatsappTransferService,
  ) {}

  @Get('/health')
  health() {
    return {
      status: 'ok',
      service: 'api',
    };
  }

  @Post('/webhooks/whatsapp')
  @HttpCode(200)
  whatsappWebhook(
    @Body() payload: Record<string, unknown>,
    @Headers('x-hub-signature-256') signature?: string,
  ) {
    const secret = process.env.META_APP_SECRET;
    if (
      !secret ||
      !this.whatsapp.verifyMetaSignature(
        JSON.stringify(payload),
        signature,
        secret,
      )
    ) {
      throw new UnauthorizedException('Invalid Meta webhook signature');
    }
    return { received: true };
  }
}
