import { HttpException, HttpStatus } from '@nestjs/common';
import type { PrismaService } from '@app/db';
import { WhatsAppIngressThrottleService } from './whatsapp-ingress-throttle.service';

describe('WhatsAppIngressThrottleService', () => {
  beforeEach(() => {
    process.env.META_APP_SECRET = 'rate-limit-secret';
    process.env.WHATSAPP_INGRESS_RATE_LIMIT_PER_MINUTE = '2';
  });

  afterEach(() => {
    delete process.env.META_APP_SECRET;
    delete process.env.WHATSAPP_INGRESS_RATE_LIMIT_PER_MINUTE;
  });

  it('creates a keyed bucket without persisting raw identity values', async () => {
    const upsert = jest.fn().mockResolvedValue(undefined);
    const prisma = {
      $transaction: jest.fn((callback: (tx: never) => Promise<unknown>) =>
        callback({
          $executeRaw: jest.fn().mockResolvedValue(0),
          whatsAppIngressRateLimitBucket: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert,
          },
        } as never),
      ),
    } as unknown as PrismaService;

    await expect(
      new WhatsAppIngressThrottleService(prisma).consume({
        chatId: 'chat-1',
        senderPhoneNumber: '+243800000001',
      }),
    ).resolves.toEqual({ allowed: true, retryAfterSeconds: 0 });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const create = upsert.mock.calls[0][0].create as Record<string, unknown>;
    expect(create.keyHash).not.toContain('chat-1');
    expect(create.keyHash).not.toContain('243800000001');
    expect(create.requestCount).toBe(1);
  });

  it('denies a bucket at the configured limit and exposes a retry window', async () => {
    const update = jest.fn();
    const prisma = {
      $transaction: jest.fn((callback: (tx: never) => Promise<unknown>) =>
        callback({
          $executeRaw: jest.fn().mockResolvedValue(0),
          whatsAppIngressRateLimitBucket: {
            findUnique: jest.fn().mockResolvedValue({
              requestCount: 2,
              expiresAt: new Date(Date.now() + 10_000),
            }),
            update,
          },
        } as never),
      ),
    } as unknown as PrismaService;

    await expect(
      new WhatsAppIngressThrottleService(prisma).consume({
        chatId: 'chat-2',
        senderPhoneNumber: '+243800000002',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ allowed: false, retryAfterSeconds: 10 }),
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('turns a denied result into a 429 boundary exception', () => {
    try {
      new WhatsAppIngressThrottleService({} as PrismaService).assertAllowed({
        allowed: false,
        retryAfterSeconds: 4,
      });
      throw new Error('Expected the throttle to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe(
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  });
});
