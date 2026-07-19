# Zongo Deployment Runbook

## Environment Model

| Environment | Host | Branch | Coolify environment |
| --- | --- | --- | --- |
| `local` | Developer workstation | Current checkout | None |
| `development` | Self-hosted server | `develop` | `development` |
| `production` | GCE VM | `main` | `production` |

GitHub Actions publishes `ghcr.io/mutabpato/zongo` for every push to
`develop` and `main`. Each release has both `sha-<commit>` and its branch
alias tag. Coolify must run `sha-<commit>`; aliases are only convenience tags.

## Compose Contract

Each environment has one self-contained Compose file. Do not layer the files
together:

| Environment | Compose command/file | Source branch | Notes |
| --- | --- | --- | --- |
| Local | `docker compose -f docker-compose.local.yml up -d` | Current checkout | Builds locally, applies migrations, and seeds the local admin. |
| Development | `docker compose -f docker-compose.dev.yml up -d` | `develop` | Managed by Coolify; applies committed migrations, then pulls and runs a published GHCR image. |
| Production | `docker compose -f docker-compose.yml up -d` | `main` | Managed by Coolify; pulls a published GHCR image. |

The remote files assemble the application image as
`$ZONGO_IMAGE:$ZONGO_IMAGE_TAG`. `ZONGO_IMAGE_TAG` must therefore be a Docker
tag in the form `sha-<full-git-commit-sha>`, never an image digest in the form
`sha256:<digest>`. A digest would produce an invalid image reference with two
colons.

Remote API, worker, and Admin services also join Coolify's external `coolify`
Docker network. This lets the Coolify Traefik proxy resolve their labelled
backends; do not remove that network attachment.

## Local Operation

```sh
cd zongo
cp infra/env/local.env.example .env.local
docker compose -f docker-compose.local.yml up -d
```

The local stack applies committed migrations automatically before starting the
API, worker, and admin services. The Admin container then upserts the local
admin identity from `.env.local` before it starts listening, so no separate
local seed command is needed.

API is available at `http://localhost:3000`; Admin is available at
`http://localhost:3002`; the worker deliberately has no host port. Postgres
and Redis are loopback-bound for local tooling only on ports `15432` and
`16379` by default; override `POSTGRES_HOST_PORT` or `REDIS_HOST_PORT` if
needed.

Stop local services with:

```sh
docker compose -f docker-compose.local.yml down
```

## One-Time Admin Bootstrap

Bootstrap is an explicit, one-time operation. It creates an `ADMIN` identity
only when no identity already exists for `ADMIN_BOOTSTRAP_EMAIL`; it never
updates, promotes, unblocks, or replaces an existing identity. Store the email
and a unique Base32 TOTP secret in the environment's secret manager, then run
the command with `ALLOW_ADMIN_BOOTSTRAP=true`. The bootstrap event is recorded
in the append-only audit log and never includes the TOTP secret.

From a source checkout with `DATABASE_URL` configured:

```sh
ALLOW_ADMIN_BOOTSTRAP=true pnpm bootstrap:admin
```

For a deployed Compose container, run the compiled command as a one-off task
and pass `ALLOW_ADMIN_BOOTSTRAP`, `ADMIN_BOOTSTRAP_EMAIL`, and
`ADMIN_BOOTSTRAP_TOTP_SECRET` as runtime-only secrets. Remove the opt-in flag
and bootstrap credentials after the command succeeds.

## One-Time Coolify Setup

1. Install Coolify on the self-hosted development server and the GCE VM. Keep
   inbound access limited to `80`, `443`, and restricted SSH; do not publish
   application, Postgres, or Redis ports.
2. Confirm Docker Compose v2 is available on each host with
   `docker compose version`. If the command is unavailable, install the
   `docker-compose-plugin` from Docker's official APT repository before
   debugging Coolify's Compose configuration errors.
3. Configure GHCR credentials on each server so Coolify can pull the private
   image. The token needs package read access only.
4. Create one Docker Compose application per remote environment using this
   repository and base directory `/zongo`: use `docker-compose.dev.yml` with
   the `develop` branch for development, and `docker-compose.yml` with the
   `main` branch for production. Keep Coolify's own Git-push auto-deploy off:
   GitHub Actions pins and deploys the immutable image after it has been
   published. Development migrations are automatic; production migrations
   remain a release gate.
   Configure the Compose resource as follows:

   | Coolify field | Value |
   | --- | --- |
   | Build pack | Docker Compose |
   | Base directory | `/zongo` |
   | Compose location, development | `docker-compose.dev.yml` |
   | Compose location, production | `docker-compose.yml` |
   | Raw Compose content, custom build/start commands, pre/post commands, container name | Leave empty |
   | Preserve repository during deployment | Off |
   | Escape special characters in labels | Off; Traefik labels interpolate hostnames |

5. Populate Coolify runtime variables from the matching file in `infra/env/`.
   Mark passwords and admin secrets as runtime-only and secret. Use URL-encoded
   Postgres/Redis passwords because they are embedded in connection URLs. Do
   not define `DATABASE_URL` in Coolify: Compose builds it from the Postgres
   values. Keep `NODE_ENV` runtime-only; setting it at build time can omit Node
   development dependencies needed to build the image.
6. Create separate public DNS records for `API_HOSTNAME`. Configure
   `ADMIN_HOSTNAME` only in Tailscale split DNS, pointing at the target
   server's Tailnet address; do not create a public DNS record for it.
7. Add `infra/coolify/zongo-admin-vpn.yaml` in each Coolify server's Proxy >
   Dynamic Configurations. This supplies the `zongo-admin-vpn@file` middleware
   referenced by the Compose stack. Install Tailscale on every admin client and
   each deployment server.
8. In GitHub, create `development` and `production` Environments. Add
   `COOLIFY_URL`, `COOLIFY_TOKEN`, and `COOLIFY_RESOURCE_UUID` to each as
   environment secrets. `COOLIFY_URL` is the publicly reachable Coolify base
   URL without `/api/v1`; create `COOLIFY_TOKEN` under **Keys & Tokens > API
   Tokens**; and obtain the resource UUID from the application URL, Coolify API,
   or a deployment log. Use one token per environment and rotate it regularly.

If a host has no public inbound address, use the procedure in
`coolify-github-cloudflare-tunnel.md` for the Coolify dashboard and GitHub App.

Coolify provides the isolated Compose network and Traefik proxy. Do not add a
custom Compose network or direct host port mapping to remote deployments.

## Release Procedure

### Development

1. Merge to `develop`. **Publish Zongo image** publishes `sha-<commit>`, then
   automatically runs the `development` deployment job. That job pins
   `ZONGO_IMAGE_TAG` to the immutable tag and asks Coolify to deploy.
2. `docker-compose.dev.yml` runs `prisma migrate deploy` before API, worker,
   and Admin start. Verify the deployment job and the Coolify health checks.

### Production

1. Merge to `main`; wait for **Publish Zongo image** to publish
   `sha-<commit>` to GHCR.
2. SSH to the production host and source its root-owned release environment file
   that contains `DATABASE_URL`. Pull and run the immutable migration image on
   the Coolify application network:

   ```sh
   docker pull ghcr.io/mutabpato/zongo:sha-<commit>
   docker run --rm --network <coolify-application-network> \
     --env DATABASE_URL="$DATABASE_URL" \
     ghcr.io/mutabpato/zongo:sha-<commit> \
     pnpm exec prisma migrate deploy
   ```

   Obtain `<coolify-application-network>` from `docker network ls` before the
   first release and record it in the host release notes. Do not run a branch
   alias for migrations.
3. Verify the migration succeeded and take a database backup if the migration
   is non-trivial.
4. Run **Promote Zongo release** with `production` and the full SHA. The
   workflow rejects SHAs not reachable from `main`, pins `ZONGO_IMAGE_TAG`,
   then asks Coolify to deploy.
5. Confirm `/health/live` and `/health/ready` for API and admin via their
   intended routes. Confirm the worker is healthy in Coolify and has no
   externally routed hostname.

## Rollback and Acceptance

Rollback uses the same promotion workflow with a previously published SHA only
after confirming the old release is compatible with the current database
schema. Never roll back by deleting database volumes or reversing committed
migrations without a recovery plan.

Accept a remote deployment only when:

- the public API hostname returns `200` from `/health/ready`;
- the admin hostname works from a Tailscale client and is rejected outside the
  Tailnet;
- Postgres and Redis are healthy and have no host-published ports;
- the worker is healthy but has no domain or host port; and
- Coolify reports successful health checks before routing traffic.

## Known Deployment Failure Modes

| Symptom | Cause | Resolution |
| --- | --- | --- |
| `invalid reference format` with `image:sha256:...` | An image digest was entered in `ZONGO_IMAGE_TAG`. | Set it to the GitHub Actions-published `sha-<full-commit-sha>` tag. |
| Coolify warns that `NODE_ENV=production` is available at build time | Build-time production mode can omit development dependencies. | Mark `NODE_ENV` runtime-only in Coolify. |
| Admin repeatedly restarts with `EACCES: permission denied, mkdir '.adminjs'` | AdminJS defaults to a relative `.adminjs` asset directory. The working directory supplied by an orchestrator can be unwritable for the unprivileged `node` user. | Keep `ADMIN_JS_TMP_DIR=/tmp/adminjs` on the `admin` Compose service. This is an absolute, container-writable location; it requires no Coolify environment variable. |
| Redis warns that `vm.overcommit_memory` is disabled | Host kernel tuning is incomplete. The warning does not prevent startup but can affect persistence under memory pressure. | On the server, set `vm.overcommit_memory = 1` using the host's standard sysctl configuration and reload it. |
| AdminJS warns about `connect.session()` MemoryStore | The current browser-session store is process-local and unsuitable for a scaled production control plane. | Treat this as a production hardening item: replace it with a persistent session store before scaling AdminJS beyond one process. |
