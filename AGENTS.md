# Repository Guidelines

## Project Structure & Module Organization

The deployable NestJS applications live in `zongo/apps/`: `api` is the public HTTP service, `worker` processes durable jobs, and `admin` hosts the internal AdminJS control plane. Shared domain code lives in `zongo/libs/` (`domain`, `db`, `audit`, `partner`, `profile`, `beneficiary`, `ledger`, and `config`). Prisma schema and migrations are under `zongo/prisma/`; local infrastructure is in `zongo/docker-compose.local.yml` and `zongo/infra/`.

Place production code in `src/`. Keep unit tests beside their subject as `*.spec.ts`; use `apps/*/test/` for E2E tests and `apps/worker/test/` for database integration tests.

## Build, Test, and Development Commands

Run commands from `zongo/`.

- `pnpm install` installs workspace dependencies.
- `docker compose -f docker-compose.local.yml up -d` starts PostgreSQL and Redis.
- `pnpm exec prisma migrate deploy` applies committed migrations; `pnpm exec prisma generate` refreshes the client.
- `pnpm start:dev:api` and `pnpm start:dev:worker` run the API and worker in watch mode.
- `port=3002 pnpm exec nest start admin --watch` runs AdminJS without conflicting with the API on port 3000.
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and `pnpm test:integration` are the required verification commands.

## Coding Style & Naming Conventions

Use TypeScript, Nest modules/services/controllers, two-space indentation, and Prettier formatting. ESLint enforces type-aware rules and Prettier. Name classes in `PascalCase`; files use kebab-case (`worker-job.processor.ts`); tests mirror the target filename (`worker-job.processor.spec.ts`). Prefer explicit domain names and ports from `@app/domain`; do not bypass service boundaries with direct database writes in controllers or AdminJS actions.

## Testing Guidelines

Write behavior-focused Jest tests before or alongside changes. Cover authorization, idempotency, audit records, failure paths, and money values as `bigint`. Integration tests require local PostgreSQL and must be explicitly enabled by `pnpm test:integration`. Keep E2E assertions at HTTP boundaries.

## Commit & Pull Request Guidelines

Use Conventional Commit-style subjects seen in history: `feat(admin): add secure control-plane foundation` or `feat: add beneficiary versioning`. Keep commits cohesive; include Prisma migrations with schema changes and `pnpm-lock.yaml` with dependency changes. PRs should state the user-visible change, schema/migration impact, verification commands run, linked issue, and screenshots for AdminJS/UI work.

## Security & Configuration

Never commit `.env`, generated `.adminjs/`, `dist/`, or `.pnpm-store/`. Load local variables with `set -a; source .env; set +a`. Preserve append-only audit behavior, role checks, TOTP requirements, and worker idempotency when changing operational flows.
