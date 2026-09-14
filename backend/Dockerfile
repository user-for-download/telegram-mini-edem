# ─── Stage 1: Build ──────────────────────────────────────────────────────────
# Node 22 — совпадает с CI (.github/workflows/ci.yml) и engines в package.json.
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY backend/package.json ./backend/
COPY telegram-app/package.json ./telegram-app/
# webapp в image не собирается, но его package.json нужен npm ci:
# корневой package.json объявляет workspace "webapp", без него установка падает.
COPY webapp/package.json ./webapp/

# IPv4-first: LAN-DNS отдаёт registry.npmjs.org в AAAA-первых,
# а IPv6 в контейнерах сборки — blackhole (нет маршрута).
# --maxsockets=2: сеть провайдера троттлит npm-registry при параллельных сокетах
# (15 по умолчанию → зависание на 15+ мин); с 2 сокетами npm ci идёт ~40с.
# cache-mount /root/.npm: скачанные tarball'ы переживают сборку — при смене
# lockfile npm ci идёт с локального диска, без повторной загрузки из сети.
RUN --mount=type=cache,target=/root/.npm \
    NODE_OPTIONS=--dns-result-order=ipv4first npm ci --maxsockets=2

COPY tsconfig.json ./

# Сборка каждого workspace сразу после его COPY: смена исходников одного
# пакета не инвалидирует слои сборки остальных (кэш Docker послойный).
COPY packages/contracts ./packages/contracts
RUN cd packages/contracts && npm run build

COPY backend ./backend
RUN cd backend && npx prisma generate && npm run build

# backend не импортирует исходники telegram-app (только runtime-путь до
# dist в app.ts), поэтому его сборка не зависит от этого COPY.
COPY telegram-app ./telegram-app
RUN cd telegram-app && npm run build

# ─── Stage 2: Production ─────────────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache openssl

# --chown на каждом COPY: владелец node фиксируется в метаданных слоя
# (мгновенно) вместо отдельного RUN chown -R по всему /app (~40с на 700МБ).
COPY --from=builder --chown=node:node /app/backend/dist ./dist
# В npm workspaces ВСЕ пакеты поднимаются в корневой node_modules;
# backend/node_modules содержит только symlink'и — копировать его поверх нельзя.
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# @hono/node-ws npm 10 кладёт вложенно в workspace (из-за peerDependencies),
# а рантайм резолвит из /app/node_modules — копируем его точечно.
COPY --from=builder --chown=node:node /app/backend/node_modules/@hono/node-ws ./node_modules/@hono/node-ws
COPY --from=builder --chown=node:node /app/backend/prisma ./prisma
COPY --from=builder --chown=node:node /app/backend/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/backend/package.json ./
COPY --from=builder --chown=node:node /app/packages/contracts/dist ./node_modules/@edem/contracts/dist
COPY --from=builder --chown=node:node /app/packages/contracts/package.json ./node_modules/@edem/contracts/
# Telegram mini-app (host-based Static в app.ts: TELEGRAM_HOSTS).
COPY --from=builder --chown=node:node /app/telegram-app/dist ./telegram-app/dist

# The application does not need root privileges at runtime.
USER node

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
