import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { isDatabaseUnavailableError } from '@app/db';
import {
  PretiumWebhookService,
  PretiumWebhookSignatureService,
} from '@app/partner';

type WebhookRequest = { rawBody?: Buffer | string };

@Controller('webhooks/pretium')
export class PretiumWebhookController {
  constructor(
    private readonly signatures: PretiumWebhookSignatureService,
    private readonly callbacks: PretiumWebhookService,
  ) {}

  @Post()
  async receive(
    @Req() request: WebhookRequest,
    @Headers('x-pretium-signature') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    if (!request.rawBody)
      throw new BadRequestException('Raw webhook body is unavailable');
    const rawBody = Buffer.isBuffer(request.rawBody)
      ? request.rawBody.toString('utf8')
      : request.rawBody;
    if (!this.signatures.verify(rawBody, signature))
      throw new UnauthorizedException(
        'Pretium webhook authentication is not configured or invalid',
      );
    const partnerReference = body.transaction_code ?? body.transactionCode;
    const providerStatus = body.status;
    if (
      typeof partnerReference !== 'string' ||
      typeof providerStatus !== 'string'
    )
      throw new BadRequestException(
        'Pretium callback identity or status is incomplete',
      );
    try {
      return await this.callbacks.apply({ partnerReference, providerStatus });
    } catch (error) {
      if (isDatabaseUnavailableError(error))
        throw new ServiceUnavailableException(
          'Database is temporarily unavailable; retry the callback',
        );
      throw error;
    }
  }
}
