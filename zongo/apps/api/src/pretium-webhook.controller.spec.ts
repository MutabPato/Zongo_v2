/* eslint-disable @typescript-eslint/unbound-method */
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import type {
  PretiumWebhookService,
  PretiumWebhookSignatureService,
} from '@app/partner';
import { PretiumWebhookController } from './pretium-webhook.controller';

describe('PretiumWebhookController', () => {
  const signatures = {
    verify: jest.fn(),
  } as unknown as PretiumWebhookSignatureService;
  const callbacks = {
    apply: jest.fn().mockResolvedValue({
      applied: true,
      transactionReference: 'ZNG-1',
    }),
  } as unknown as PretiumWebhookService;
  const controller = new PretiumWebhookController(signatures, callbacks);

  beforeEach(() => jest.clearAllMocks());

  it('rejects a callback without the original raw body', async () => {
    await expect(
      controller.receive({}, 'sha256=signature', {
        transaction_code: 'pt-1',
        status: 'COMPLETE',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(signatures.verify).not.toHaveBeenCalled();
    expect(callbacks.apply).not.toHaveBeenCalled();
  });

  it('rejects authentication before dispatching the callback', async () => {
    (signatures.verify as jest.Mock).mockReturnValue(false);

    await expect(
      controller.receive(
        { rawBody: Buffer.from('{"transaction_code":"pt-2"}') },
        'sha256=invalid',
        { transaction_code: 'pt-2', status: 'COMPLETE' },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(callbacks.apply).not.toHaveBeenCalled();
  });

  it('forwards only normalized callback identity after authentication', async () => {
    (signatures.verify as jest.Mock).mockReturnValue(true);
    const rawBody = '{"transactionCode":"pt-3","status":"COMPLETE"}';

    await expect(
      controller.receive({ rawBody }, 'sha256=valid', {
        transactionCode: 'pt-3',
        status: 'COMPLETE',
        raw_payload: 'must-not-forward',
        secret: 'must-not-forward',
      }),
    ).resolves.toEqual({ applied: true, transactionReference: 'ZNG-1' });
    expect(signatures.verify).toHaveBeenCalledWith(rawBody, 'sha256=valid');
    expect(callbacks.apply).toHaveBeenCalledWith({
      partnerReference: 'pt-3',
      providerStatus: 'COMPLETE',
    });
  });

  it('rejects callbacks without a reference or status', async () => {
    (signatures.verify as jest.Mock).mockReturnValue(true);

    await expect(
      controller.receive({ rawBody: '{}' }, 'sha256=valid', {
        transaction_code: 'pt-4',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(callbacks.apply).not.toHaveBeenCalled();
  });
});
