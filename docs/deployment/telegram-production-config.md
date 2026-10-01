# Telegram production configuration

**Task:** tg-migration-22.
**Status:** ready to apply — NOT applied (no production host/data/sign-off;
исторический canary-отчёт удалён из дерева — смотри git, verdict был NO-GO).
**Base images:** `docker-compose.yml` (backend builds both UIs, serves by Host).

## 1. Production `.env` (values in the secrets manager, never in git)

```dotenv
POSTGRES_PASSWORD=<generated>
JWT_SECRET=<≥32 chars, generated>
CORS_ORIGINS=https://<tg-prod-host>
TELEGRAM_BOT_TOKEN=<BotFather token, required by compose>
TELEGRAM_HOSTS=<tg-prod-host>                 # exact Host; else 404
TG_INIT_DATA_TTL_SECONDS=3600
TELEGRAM_DELIVERY_ENABLED=true
TG_NOTIFICATION_DEDUPE_WINDOW_MS=60000
ADMIN_TOKEN=<generated, or empty to close admin>
METRICS_TOKEN=<generated>
SENTRY_DSN=<backend project DSN>
CLIENT_ERRORS_ENABLED=true
ERROR_ALERT_CHAT_ID=<telegram group chat id, negative; empty = log only>
APP_VERSION=<release tag>
ALLOW_DEV_AUTH=false                            # compose hardcodes; never override in prod
TRUST_PROXY=true                                # §2, mandatory behind proxy
# Других auth-провайдеров нет — только Telegram.
```

Build-time (telegram-app bundle):

```dotenv
VITE_API_URL=https://<tg-prod-host>/api/v1   # or empty for same-origin
```

## 2. Reverse proxy (mandatory settings)

The backend selects the served frontend **by `Host`**, rate-limits **by client IP**,
upgrades **WebSocket** on `/api/v1/ws`. The proxy MUST:

- pass `Host` unchanged (`proxy_set_header Host $host`) —
  otherwise every visitor gets the wrong frontend;
- **rewrite** (not append) `X-Real-IP` / `X-Forwarded-For` to `$remote_addr` —
  otherwise any client can spoof its rate-limit bucket;
- set `TRUST_PROXY=true` in backend env (compose default is `"false"`) —
  without it all clients share one TCP-socket IP bucket → mass 429
  (`TG_AUTH_RATE_MAX` 5/5min would lock out everyone after 5 logins);
- forward `Upgrade` + `Connection` for `/api/v1/ws` (101 + 4401-timeout
  verified by `scripts/smoke-telegram-deployment.mjs`).

Nginx sketch (adapt to the actual edge):

```nginx
location / {
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  proxy_set_header X-Forwarded-For $remote_addr;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_pass http://127.0.0.1:3000;
}
```

## 3. Database & migrations

- Entry point runs `npx prisma migrate deploy` before boot — deploy is
  migration-safe by construction; verify `GET /health/ready` → 200 after.
- Pre-cutover snapshot: `backend/scripts/backup.sh` (verify + retain);
  record dump name in the canary report.

## 4. Rollout order (when approved)

1. Snapshot + manifest.
2. Deploy with Telegram env (§1) + proxy (§2). Rebuild the stand with
   `sh scripts/prod-rebuild.sh` — it polls `GET /health/ready` (migrations
   run on boot) instead of a fixed sleep, and any red check exits non-zero.
   `--clean` for a base-image/platform change, `--smoke` to run step 3 inline.
3. Smoke 6/6 (`scripts/smoke-telegram-deployment.mjs` with `TG_HOST`).
4. Observe against ранее зафиксированных go-no-go порогов (файл удалён из дерева — смотри git).
5. Record GO (proceed) or NO-GO (rollback via
   `scripts/rollback-telegram-migration.mjs --execute`) with timestamp,
   evidence and approver.
