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
  role?: AdminRole;
};

/** Upserts explicitly configured local control-plane identities only. */
export async function upsertLocalAdmin(
  prisma: LocalAdminPrisma,
  config: LocalAdminConfig,
): Promise<void> {
  const role = config.role ?? AdminRole.ADMIN;
  await prisma.platformIdentity.upsert({
    where: { userId: config.email },
    create: {
      userId: config.email,
      role,
      totpSecret: config.totpSecret,
      blockedAt: null,
    },
    update: {
      role,
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

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Local admin seeding is disabled in production');

  const email = requiredEnvironment('LOCAL_ADMIN_EMAIL');
  const totpSecret = requiredEnvironment('LOCAL_ADMIN_TOTP_SECRET');
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const identities: LocalAdminConfig[] = [
      { email, totpSecret, role: AdminRole.ADMIN },
    ];
    const optionalRoles: Array<[AdminRole, string, string]> = [
      [AdminRole.SUPPORT, 'LOCAL_SUPPORT_EMAIL', 'LOCAL_SUPPORT_TOTP_SECRET'],
      [AdminRole.OPS, 'LOCAL_OPS_EMAIL', 'LOCAL_OPS_TOTP_SECRET'],
    ];
    for (const [role, emailName, secretName] of optionalRoles) {
      const optionalEmail = optionalEnvironment(emailName);
      const optionalSecret = optionalEnvironment(secretName);
      if (optionalEmail && optionalSecret)
        identities.push({
          email: optionalEmail,
          totpSecret: optionalSecret,
          role,
        });
    }
    for (const identity of identities) await upsertLocalAdmin(prisma, identity);
    console.log(
      `Local control-plane identities are ready: ${identities
        .map((identity) => `${identity.role}:${identity.email}`)
        .join(', ')}`,
    );
  } finally {
    await prisma.onModuleDestroy();
  }
}

if (require.main === module) void main();
