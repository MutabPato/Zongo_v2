import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  WhatsAppSessionService,
  WhatsAppWebhookSignatureService,
} from '@app/whatsapp';

type WebhookRequest = { rawBody?: Buffer | string };

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly signatures: WhatsAppWebhookSignatureService,
    private readonly sessions: WhatsAppSessionService,
  ) {}

  @Post()
  async receive(
    @Req() request: WebhookRequest,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    if (!request.rawBody)
      throw new BadRequestException('Raw webhook body is unavailable');
    const rawBody = Buffer.isBuffer(request.rawBody)
      ? request.rawBody.toString('utf8')
      : request.rawBody;
    const appSecret = process.env.META_APP_SECRET;
    if (!this.signatures.verify(rawBody, signature, appSecret ?? ''))
      throw new UnauthorizedException('Invalid WhatsApp webhook signature');

    const externalEventId = this.stringValue(body.id ?? body.event_id);
    const chatId = this.stringValue(body.chat_id ?? body.from);
    const senderPhoneNumber = this.stringValue(
      body.sender_phone_number ?? body.from,
    );
    if (!externalEventId || !chatId || !senderPhoneNumber)
      throw new BadRequestException('Webhook event identity is incomplete');

    const result = await this.sessions.acceptInbound({
      externalEventId,
      chatId,
      senderPhoneNumber,
      payloadRedacted: { type: body.type, messageId: body.message_id },
      messageText: this.stringValue(body.text ?? body.message),
    });
    return { received: true, ...result };
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }
}
