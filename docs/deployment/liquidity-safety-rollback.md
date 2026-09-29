# Liquidity Safety Release Runbook

## Preflight

1. Take a PostgreSQL backup or verified restore point.
2. Run `docker compose config --quiet` without publishing its interpolated output.
3. Confirm `BACKEND_BIND_ADDR=127.0.0.1` and `WEBAPP_BIND_ADDR=127.0.0.1` when the reverse proxy is on the same host. If either is `0.0.0.0`, firewall ports 3000/3014 to the proxy only.
4. Run `npm audit --omit=dev --audit-level=high`. Current Prisma transitive dependencies report four high findings; do not run `npm audit fix --force` during deployment because it would downgrade Prisma and requires a separate dependency change.

## Deploy

1. Standard rebuild: `sh scripts/prod-rebuild.sh` — builds backend+webapp,
   recreates containers and polls `/health/ready` (migrations run on boot);
   any red check exits non-zero. `--smoke` also runs
   `scripts/smoke-telegram-deployment.mjs`; `--clean` on a base-image/platform
   change; `--no-build` for `.env`-only changes.
2. Or build the image explicitly: `docker build -f backend/Dockerfile -t edem-backend:release .`.
3. Apply migrations through the normal backend startup procedure.
4. Verify `/health/ready`, API routes, admin cookie session, SPA fallback and WebSocket upgrade through the public proxy.
5. Run `node e2e/telegram-parity.mjs` against the release environment.

## Rollback

Database migrations are forward-only. Rolling back the container image does not roll back schema. Keep the release image compatible with the additive migrations (`Booking`/`Trip` audit fields, `RideRequest`, `Report`, `User.deletedAt`, report unique index). If a release must be reverted, first restore the database snapshot or deploy an explicitly schema-compatible hotfix image; never assume image rollback alone is sufficient.

## Current Risk Acceptance

- Rate limiting and WebSocket fan-out are process-local; use one backend instance or add Redis/pub-sub before horizontal scaling.
- Admin report actor is recorded as type `admin`; the static admin JWT has no individual operator identity.
- `npm audit` findings are transitive Prisma tooling dependencies and require a separately tested dependency upgrade.
