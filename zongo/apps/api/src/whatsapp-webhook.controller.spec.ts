/* eslint-disable @typescript-eslint/unbound-method */
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { WhatsAppSessionService } from '@app/whatsapp';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import type { WhatsAppWebhookSignatureService } from '@app/whatsapp';

describe('WhatsAppWebhookController', () => {
  const sessions = {
    acceptInbound: jest.fn().mockResolvedValue({
      duplicate: false,
      accepted: true,
      sessionId: 'session_1',
    }),
  } as unknown as WhatsAppSessionService;
  const signatures = {
    verify: jest.fn(),
  } as unknown as WhatsAppWebhookSignatureService;
  const controller = new WhatsAppWebhookController(signatures, sessions);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = 'meta-secret';
  });

  afterAll(() => {
    delete process.env.META_APP_SECRET;
  });

  it('rejects an invalid signature before touching the session boundary', async () => {
    (signatures.verify as jest.Mock).mockReturnValue(false);

    await expect(
      controller.receive(
        { rawBody: Buffer.from('{"id":"event_1"}') },
        'sha256=invalid',
        { id: 'event_1' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.acceptInbound).not.toHaveBeenCalled();
  });

  it('forwards only normalized inbound identity and message fields after verification', async () => {
    (signatures.verify as jest.Mock).mockReturnValue(true);
    const rawBody =
      '{"id":"event_2","from":"+243800000001","text":"tuma pesa"}';

    await expect(
      controller.receive({ rawBody }, 'sha256=valid', {
        id: 'event_2',
        from: '+243800000001',
        text: 'tuma pesa',
        type: 'text',
        message_id: 'message_2',
        secret: 'must-not-forward',
      }),
    ).resolves.toEqual({
      received: true,
      duplicate: false,
      accepted: true,
      sessionId: 'session_1',
    });
    expect(signatures.verify).toHaveBeenCalledWith(
      rawBody,
      'sha256=valid',
      'meta-secret',
    );
    expect(sessions.acceptInbound).toHaveBeenCalledWith({
      externalEventId: 'event_2',
      chatId: '+243800000001',
      senderPhoneNumber: '+243800000001',
      payloadRedacted: { type: 'text', messageId: 'message_2' },
      messageText: 'tuma pesa',
    });
  });

  it('rejects events without a complete identity', async () => {
    (signatures.verify as jest.Mock).mockReturnValue(true);

    await expect(
      controller.receive({ rawBody: '{}' }, 'sha256=valid', {
        id: 'event_3',
        text: 'status',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sessions.acceptInbound).not.toHaveBeenCalled();
  });
});
