import type { INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { PrismaService } from '@app/db';
import { AdminService } from './admin.service';

type PrismaDmmfModel = {
  name: string;
  fields: Array<Record<string, unknown> & { name: string }>;
};

type AdminJsRequest = {
  method: string;
  payload?: Record<string, string | undefined>;
};

type AdminJsContext = {
  currentAdmin?: { id?: string; role?: string };
  record?: {
    params: Record<string, unknown>;
    toJSON: (admin?: unknown) => unknown;
  };
  resource: {
    findOne: (
      id: string,
    ) => Promise<{ toJSON: (admin?: unknown) => unknown } | null>;
    _decorated?: { id: () => string };
    id: () => string;
  };
  h: { resourceUrl: (input: { resourceId: string }) => string };
};

type ExpressApplication = {
  set: (
    setting: string,
    value: (_key: string, value: unknown) => unknown,
  ) => void;
};

/**
 * @adminjs/prisma 5 reads the Prisma 5/6 DMMF `isId` field. Prisma 7 omits
 * that flag from its exposed DMMF even though every model still has an `id`
 * primary key. Add the flag back to the adapter-facing copy only.
 */
function adminJsModel(model: PrismaDmmfModel): PrismaDmmfModel {
  return {
    ...model,
    fields: model.fields.map((field) => ({
      ...field,
      isId: field.name === 'id',
    })),
  };
}

/**
 * AdminJS is ESM-only. Loading it dynamically keeps the Nest/Jest CommonJS
 * test runtime stable while mounting the same self-hosted UI in production.
 */
export async function mountAdminJs(app: INestApplication): Promise<void> {
  // Prisma represents monetary minor units as bigint. JSON has no bigint
  // primitive, so AdminJS list/show responses must expose them as strings to
  // retain their exact value (rather than silently rounding to number).
  const expressApp = app.getHttpAdapter().getInstance() as ExpressApplication;
  expressApp.set('json replacer', (_key: string, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );

  const [
    adminJsModule,
    prismaAdapter,
    { default: AdminJSExpress },
    expressModule,
  ] = await Promise.all([
    import('adminjs'),
    import('@adminjs/prisma'),
    import('@adminjs/express'),
    import('express'),
  ]);
  const { default: AdminJS, Router: AdminRouter } = adminJsModule;
  const { Database, Resource, getModelByName } = prismaAdapter;
  AdminJS.registerAdapter({ Database, Resource });

  const prisma = app.get(PrismaService);
  const controlPlane = app.get(AdminService);
  const tierPolicyActions = {
    new: { isAccessible: false },
    delete: { isAccessible: false },
    bulkDelete: { isAccessible: false },
    edit: {
      isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
        currentAdmin?.role === 'ADMIN',
      handler: async (
        request: AdminJsRequest,
        _response: unknown,
        context: AdminJsContext,
      ) => {
        if (!context.record || !context.currentAdmin?.id)
          throw new Error(
            'An authenticated admin and policy record are required',
          );
        if (context.record.params.tier !== 'TIER_0')
          throw new Error('Only the TIER_0 transfer-cap policy is editable');

        if (request.method === 'get')
          return { record: context.record.toJSON(context.currentAdmin) };

        const perTransferLimitMinor = request.payload?.perTransferLimitMinor;
        const dailyLimitMinor = request.payload?.dailyLimitMinor;
        if (!perTransferLimitMinor || !dailyLimitMinor)
          throw new Error('Both Tier 0 transfer caps are required');

        const policy = await controlPlane.setTier0TransferCaps(
          context.currentAdmin.id,
          BigInt(perTransferLimitMinor),
          BigInt(dailyLimitMinor),
        );
        const updatedRecord = await context.resource.findOne(policy.id);
        if (!updatedRecord)
          throw new Error('Tier 0 policy was not found after update');
        return {
          record: updatedRecord.toJSON(context.currentAdmin),
          redirectUrl: context.h.resourceUrl({
            resourceId:
              context.resource._decorated?.id() ?? context.resource.id(),
          }),
          notice: {
            message: 'Tier 0 caps updated and audited',
            type: 'success',
          },
        };
      },
    },
  };
  const transferActions = {
    new: { isAccessible: false },
    edit: { isAccessible: false },
    delete: { isAccessible: false },
    bulkDelete: { isAccessible: false },
    statusRecheck: {
      actionType: 'record',
      icon: 'Refresh',
      guard: 'Queue a partner status recheck for this transfer?',
      isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
        currentAdmin?.role === 'OPS' || currentAdmin?.role === 'ADMIN',
      handler: async (
        request: AdminJsRequest,
        _response: unknown,
        context: AdminJsContext,
      ) => {
        if (!context.record || !context.currentAdmin?.id)
          throw new Error(
            'An authenticated ops user and transfer are required',
          );
        if (request.method === 'post')
          await controlPlane.recheckStatus(
            context.currentAdmin.id,
            String(context.record.params.reference),
          );
        return {
          record: context.record.toJSON(context.currentAdmin),
          notice: {
            message: 'Status recheck queued and audited',
            type: 'success',
          },
        };
      },
    },
    retryPayout: {
      actionType: 'record',
      icon: 'Restart',
      guard: 'Prepare a controlled payout retry for this transfer?',
      isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
        currentAdmin?.role === 'OPS' || currentAdmin?.role === 'ADMIN',
      handler: async (
        request: AdminJsRequest,
        _response: unknown,
        context: AdminJsContext,
      ) => {
        if (!context.record || !context.currentAdmin?.id)
          throw new Error(
            'An authenticated ops user and transfer are required',
          );
        if (request.method === 'post')
          await controlPlane.retryFailedPayout(
            context.currentAdmin.id,
            String(context.record.params.reference),
          );
        return {
          record: context.record.toJSON(context.currentAdmin),
          notice: {
            message: 'Eligible payout retry prepared and audited',
            type: 'success',
          },
        };
      },
    },
  };
  const identityActions = {
    new: { isAccessible: false },
    edit: { isAccessible: false },
    delete: { isAccessible: false },
    bulkDelete: { isAccessible: false },
    block: {
      actionType: 'record',
      icon: 'Locked',
      guard: 'Block this identity? This prevents future access.',
      isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
        currentAdmin?.role === 'ADMIN',
      handler: async (
        request: AdminJsRequest,
        _response: unknown,
        context: AdminJsContext,
      ) => {
        if (!context.record || !context.currentAdmin?.id)
          throw new Error('An authenticated admin and identity are required');
        if (request.method === 'post')
          await controlPlane.setUserBlocked(
            context.currentAdmin.id,
            String(context.record.params.userId),
            true,
            'Blocked from AdminJS control plane',
          );
        return {
          record: context.record.toJSON(context.currentAdmin),
          notice: { message: 'Identity blocked and audited', type: 'success' },
        };
      },
    },
    unblock: {
      actionType: 'record',
      icon: 'Unlocked',
      guard: 'Unblock this identity?',
      isAccessible: ({ currentAdmin }: { currentAdmin?: { role?: string } }) =>
        currentAdmin?.role === 'ADMIN',
      handler: async (
        request: AdminJsRequest,
        _response: unknown,
        context: AdminJsContext,
      ) => {
        if (!context.record || !context.currentAdmin?.id)
          throw new Error('An authenticated admin and identity are required');
        if (request.method === 'post')
          await controlPlane.setUserBlocked(
            context.currentAdmin.id,
            String(context.record.params.userId),
            false,
          );
        return {
          record: context.record.toJSON(context.currentAdmin),
          notice: {
            message: 'Identity unblocked and audited',
            type: 'success',
          },
        };
      },
    },
  };
  const admin = new AdminJS({
    rootPath: '/backoffice',
    loginPath: '/backoffice/login',
    logoutPath: '/backoffice/logout',
    branding: { companyName: 'Zongo Operations (MFA required)' },
    resources: [
      'TransferTransaction',
      'Beneficiary',
      'TransactionReconciliation',
      'AuditEvent',
      'TierLimitPolicy',
      'PlatformIdentity',
    ].map((model) => ({
      resource: {
        model: adminJsModel(getModelByName(model) as PrismaDmmfModel),
        client: prisma,
      },
      options: {
        actions:
          model === 'TierLimitPolicy'
            ? tierPolicyActions
            : model === 'TransferTransaction'
              ? transferActions
              : model === 'PlatformIdentity'
                ? identityActions
                : {
                    new: { isAccessible: false },
                    edit: { isAccessible: false },
                    delete: { isAccessible: false },
                    bulkDelete: { isAccessible: false },
                  },
      },
    })),
  });
  const assetRouter = expressModule.default.Router();
  for (const asset of AdminRouter.assets) {
    assetRouter.get(asset.path, (_request, response) => {
      response.type(asset.path).send(readFileSync(asset.src));
    });
  }
  const router = AdminJSExpress.buildAuthenticatedRouter(
    admin,
    {
      authenticate: async (userId: string, totpCode: string) => {
        try {
          const session = await controlPlane.login(userId, totpCode);
          const actor = await controlPlane.actorFromSession(
            session.accessToken,
          );
          return {
            email: actor.userId,
            id: actor.id,
            title: actor.role.toLowerCase(),
            role: actor.role,
          };
        } catch {
          return null;
        }
      },
      cookieName: 'zongo_admin',
      cookiePassword:
        process.env.ADMINJS_COOKIE_SECRET ?? 'change-me-in-production',
    },
    assetRouter,
    {
      resave: false,
      saveUninitialized: false,
      cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true },
    },
  );
  app.use('/backoffice', router);
}
