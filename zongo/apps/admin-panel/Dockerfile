FROM node:22-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.17.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin-panel/package.json apps/admin-panel/package.json
RUN pnpm install --frozen-lockfile
COPY apps/admin-panel apps/admin-panel
RUN pnpm --filter @zongo/admin-panel build

FROM nginx:1.29-alpine AS runtime
COPY apps/admin-panel/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/admin-panel/dist /usr/share/nginx/html/backoffice

EXPOSE 8080
