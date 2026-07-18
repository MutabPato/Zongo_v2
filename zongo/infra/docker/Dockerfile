FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
# Prisma loads prisma.config.ts during generation but does not connect here.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build?schema=public pnpm exec prisma generate \
  && pnpm exec nest build api \
  && pnpm exec nest build worker \
  && pnpm exec tsc --project apps/admin/tsconfig.app.json

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

# curl powers container health checks; the node user keeps app processes unprivileged.
RUN apt-get update \
  && apt-get install --no-install-recommends -y curl \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable \
  && corepack prepare pnpm@10.17.0 --activate

COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/prisma.config.ts ./prisma.config.ts

# AdminJS is compiled without webpack and retains the monorepo @app/* imports.
RUN mkdir -p node_modules/@app \
  && ln -s /app/dist/apps/admin/libs/audit/src node_modules/@app/audit \
  && ln -s /app/dist/apps/admin/libs/beneficiary/src node_modules/@app/beneficiary \
  && ln -s /app/dist/apps/admin/libs/db/src node_modules/@app/db \
  && ln -s /app/dist/apps/admin/libs/domain/src node_modules/@app/domain \
  && ln -s /app/dist/apps/admin/libs/partner/src node_modules/@app/partner \
  && ln -s /app/dist/apps/admin/libs/profile/src node_modules/@app/profile

# AdminJS builds its runtime asset bundle here when the Admin service starts.
RUN mkdir -p /app/.adminjs \
  && chown node:node /app/.adminjs

USER node

CMD ["node", "dist/apps/api/main"]
