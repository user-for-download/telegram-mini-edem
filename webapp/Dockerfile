# ─── Stage 1: Build ──────────────────────────────────────────────────────────
# Node 22 — совпадает с CI (.github/workflows/ci.yml) и engines в package.json.
FROM node:22-alpine AS builder

WORKDIR /app

# npm workspaces: для npm ci нужны package.json ВСЕХ workspace'ов,
# объявленных в корневом package.json (иначе установка падает).
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY backend/package.json ./backend/
COPY telegram-app/package.json ./telegram-app/
COPY webapp/package.json ./webapp/

# IPv4-first + --maxsockets=2: см. backend/Dockerfile (LAN-DNS отдаёт AAAA-первых,
# в контейнерах сборки IPv6 — blackhole; сеть троттлит npm при 15 параллельных сокетах).
# cache-mount /root/.npm: tarball'ы переживают сборку — смена lockfile не качается заново.
RUN --mount=type=cache,target=/root/.npm \
    NODE_OPTIONS=--dns-result-order=ipv4first npm ci --maxsockets=2

COPY packages/contracts ./packages/contracts
COPY webapp ./webapp

# webapp резолвит @edem/contracts из исходников (tsc paths + vite alias),
# поэтому сборка dist контрактов не требуется.
RUN cd webapp && npm run build

# ─── Stage 2: nginx ──────────────────────────────────────────────────────────
FROM nginx:1.27-alpine

# SPA + проксирование /api на backend (см. комментарии в конфиге).
COPY webapp/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/webapp/dist /usr/share/nginx/html

EXPOSE 80
