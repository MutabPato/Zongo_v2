import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@app/db';

export type WhatsAppIngressThrottleResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

/**
 * Postgres-authoritative fallback throttling for signed WhatsApp ingress.
 * Redis is intentionally not required: a durable keyed hash and a
 * transaction-scoped advisory lock keep the limit conservative across API
 * replicas while never persisting raw contact or chat identifiers.
 */
@Injectable()
export class WhatsAppIngressThrottleService {
  private readonly windowMs = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  async consume(input: {
    chatId: string;
    senderPhoneNumber: string;
  }): Promise<WhatsAppIngressThrottleResult> {
    const secret =
      process.env.WHATSAPP_RATE_LIMIT_KEY ?? process.env.META_APP_SECRET;
    if (!secret)
      throw new Error('WhatsApp ingress throttling key is not configured');
    const limit = this.limit();
    const keyHash = createHmac('sha256', secret)
      .update(`${input.chatId}:${input.senderPhoneNumber}`)
      .digest('base64url');
    const now = new Date();
    const nextWindow = new Date(now.getTime() + this.windowMs);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0))`,
      );
      const bucket = await tx.whatsAppIngressRateLimitBucket.findUnique({
        where: { keyHash },
      });
      if (!bucket || bucket.expiresAt <= now) {
        await tx.whatsAppIngressRateLimitBucket.upsert({
          where: { keyHash },
          create: {
            keyHash,
            windowStartedAt: now,
            expiresAt: nextWindow,
            requestCount: 1,
          },
          update: {
            windowStartedAt: now,
            expiresAt: nextWindow,
            requestCount: 1,
          },
        });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (bucket.requestCount >= limit)
        return {
          allowed: false,
          retryAfterSeconds: Math.max(
            1,
            Math.ceil((bucket.expiresAt.getTime() - now.getTime()) / 1000),
          ),
        };
      await tx.whatsAppIngressRateLimitBucket.update({
        where: { keyHash },
        data: { requestCount: { increment: 1 } },
      });
      return { allowed: true, retryAfterSeconds: 0 };
    });
  }

  assertAllowed(result: WhatsAppIngressThrottleResult): void {
    if (!result.allowed)
      throw new HttpException(
        {
          message: 'WhatsApp ingress is temporarily rate limited',
          retryAfterSeconds: result.retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
  }

  private limit(): number {
    const value = Number(
      process.env.WHATSAPP_INGRESS_RATE_LIMIT_PER_MINUTE ?? 30,
    );
    if (!Number.isInteger(value) || value <= 0)
      throw new Error(
        'WHATSAPP_INGRESS_RATE_LIMIT_PER_MINUTE must be a positive integer',
      );
    return value;
  }
}
