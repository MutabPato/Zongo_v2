import { AdminRole, type Prisma } from '@prisma/client';
import { PrismaService } from '@app/db';

type LocalAdminPrisma = {
  platformIdentity: {
    upsert: (args: Prisma.PlatformIdentityUpsertArgs) => Promise<unknown>;
  };
};

type LocalAdminConfig = {
  email: string;
  totpSecret: string;
};

/** Upserts the sole development bootstrap administrator from explicit environment settings. */
export async function upsertLocalAdmin(
  prisma: LocalAdminPrisma,
  config: LocalAdminConfig,
): Promise<void> {
  await prisma.platformIdentity.upsert({
    where: { userId: config.email },
    create: {
      userId: config.email,
      role: AdminRole.ADMIN,
      totpSecret: config.totpSecret,
      blockedAt: null,
    },
    update: {
      role: AdminRole.ADMIN,
      totpSecret: config.totpSecret,
      blockedAt: null,
      blockedReason: null,
      blockedById: null,
    },
  });
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Local admin seeding is disabled in production');

  const email = requiredEnvironment('LOCAL_ADMIN_EMAIL');
  const totpSecret = requiredEnvironment('LOCAL_ADMIN_TOTP_SECRET');
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    await upsertLocalAdmin(prisma, {
      email,
      totpSecret,
    });
    console.log(`Local admin identity is ready for ${email}`);
  } finally {
    await prisma.onModuleDestroy();
  }
}

if (require.main === module) void main();
