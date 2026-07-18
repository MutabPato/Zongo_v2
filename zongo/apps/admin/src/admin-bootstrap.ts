import { PrismaService } from '@app/db';
import { AdminRole, AuditEventType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

type AdminBootstrapConfig = {
  email: string;
  totpSecret: string;
};

export function assertBootstrapEnabled(value: string | undefined): void {
  if (value !== 'true')
    throw new Error('ALLOW_ADMIN_BOOTSTRAP=true is required');
}

export async function bootstrapAdmin(
  prisma: Pick<PrismaService, 'platformIdentity' | '$transaction'>,
  config: AdminBootstrapConfig,
): Promise<void> {
  const existing = await prisma.platformIdentity.findUnique({
    where: { userId: config.email },
  });
  if (existing)
    throw new Error(`An identity for ${config.email} already exists`);

  await prisma.$transaction(async (transaction) => {
    const identity = await transaction.platformIdentity.create({
      data: {
        userId: config.email,
        role: AdminRole.ADMIN,
        totpSecret: config.totpSecret,
      },
    });
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        eventType: AuditEventType.BUSINESS,
        name: 'admin.bootstrap.created',
        actorType: 'SYSTEM',
        actorId: identity.id,
        payload: { email: config.email, role: AdminRole.ADMIN },
      },
    });
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  assertBootstrapEnabled(process.env.ALLOW_ADMIN_BOOTSTRAP);
  const email = requiredEnvironment('ADMIN_BOOTSTRAP_EMAIL');
  const totpSecret = requiredEnvironment('ADMIN_BOOTSTRAP_TOTP_SECRET');
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await bootstrapAdmin(prisma, { email, totpSecret });
    console.log(`Bootstrap admin identity created for ${email}`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

if (require.main === module)
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
