#!/bin/sh
# Прод-режим: сборка backend+webapp, пересоздание контейнеров, health-check.
#
# По умолчанию — инкрементально: layer-кэш Docker переживает сборку,
# npm ci и нетронутые исходники не пересобираются (смена только backend
# → webapp берётся целиком из кэша, и наоборот). Это в разы быстрее full.
#
# Готовность ждём ОПРОСОМ /health/ready (backend применяет миграции на
# старте), а не фиксированным sleep: под нагрузкой/на медленном хосте
# sleep мог не дождаться и скрипт заканчивался успехом при мёртвом бэкенде.
# Любая красная проверка → exit 1 + диагностика (ps, логи).
#
# Опции:
#   --clean     полный сброс: prune builder/image + build --no-cache
#               (нужен при смене базового образа/платформы или протухшем кэше;
#               no-cache сборки забивают диск — было 99%)
#   --no-build  не собирать образы, только пересоздать контейнеры
#               (смена .env/лимитов без изменения кода)
#   --smoke     после health прогнать scripts/smoke-telegram-deployment.mjs
#   -h|--help   справка
#
# Env-override: HEALTH_TIMEOUT (сек, дефолт 90), HEALTH_URL, WEBAPP_URL, TG_HOST.
# TG_HOST по умолчанию берётся из TELEGRAM_HOSTS (окружение или .env) —
# Host-проверка должна бить по реальному домену стенда, а не по хардкоду.
#
# Использование: sh scripts/prod-rebuild.sh [--clean] [--no-build] [--smoke]

set -eu

usage() {
  # Help = ведущий блок комментариев: от строки после shebang до первой
  # не-# строки. Не завязан на номера строк — правки шапки не сломают справку.
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "$0"
}

# Работаем из корня репозитория независимо от cwd вызова.
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

CLEAN=0
NO_BUILD=0
SMOKE=0
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    --no-build) NO_BUILD=1 ;;
    --smoke) SMOKE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "prod-rebuild: неизвестная опция: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$CLEAN" -eq 1 ] && [ "$NO_BUILD" -eq 1 ]; then
  echo "prod-rebuild: --clean и --no-build взаимоисключающи" >&2
  exit 2
fi

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/health/ready}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
WEBAPP_URL="${WEBAPP_URL:-http://127.0.0.1:3014/}"

# TG_HOST: явный override → TELEGRAM_HOSTS из окружения → первая запись из .env.
if [ -z "${TG_HOST:-}" ]; then
  tg_hosts="$(printenv TELEGRAM_HOSTS 2>/dev/null || true)"
  if [ -z "$tg_hosts" ] && [ -f .env ]; then
    tg_hosts="$(sed -n 's/^TELEGRAM_HOSTS=//p' .env | tail -1)"
  fi
  TG_HOST="$(printf '%s' "$tg_hosts" | tr ',' '\n' | sed 's/#.*//' | tr -d ' "' | awk 'NF{print; exit}')"
fi

echo "==> prod-rebuild: $(git rev-parse --short HEAD 2>/dev/null || echo 'no-git') $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ "$NO_BUILD" -eq 0 ]; then
  if [ "$CLEAN" -eq 1 ]; then
    echo "==> clean: prune builder+image, build --no-cache"
    docker builder prune -af
    docker image prune -af
    docker compose build --no-cache backend webapp
  else
    echo "==> incremental build: backend webapp"
    docker compose build backend webapp
  fi
else
  echo "==> --no-build: пропускаем сборку образов"
fi

echo "==> recreate: backend webapp"
docker compose up -d --force-recreate backend webapp

# 1. Готовность: опрос до HEALTH_TIMEOUT секунд.
echo "==> waiting for /health/ready (<= ${HEALTH_TIMEOUT}s)"
i=0
ready=0
while [ "$i" -lt "$HEALTH_TIMEOUT" ]; do
  if curl -fsS -o /dev/null "$HEALTH_URL" 2>/dev/null; then
    ready=1
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "FAIL | health/ready не поднялся за ${HEALTH_TIMEOUT}s ($HEALTH_URL)"
  echo "--- docker compose ps ---"
  docker compose ps
  echo "--- backend logs (40) ---"
  docker compose logs --tail=40 backend
  echo "--- подсказка: rollback — docker compose up -d --force-recreate backend webapp"
  exit 1
fi
echo "PASS | health/ready 200 ($HEALTH_URL)"

# 2. Остальные проверки: считаем красные, падаем в конце.
fails=0
chk() {
  name="$1"
  url="$2"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    echo "PASS | $name | HTTP $code"
  else
    echo "FAIL | $name | HTTP $code"
    fails=$((fails + 1))
  fi
}

chk "health/live" "http://127.0.0.1:3000/health/live"
chk "webapp" "$WEBAPP_URL"

if [ -n "$TG_HOST" ]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $TG_HOST" http://127.0.0.1:3000/ 2>/dev/null || echo 000)"
  if [ "$code" = "200" ]; then
    echo "PASS | tg-host | HTTP $code | $TG_HOST"
  else
    echo "FAIL | tg-host | HTTP $code | $TG_HOST"
    fails=$((fails + 1))
  fi
else
  echo "SKIP | tg-host (TG_HOST не задан и TELEGRAM_HOSTS пуст)"
fi

echo "--- миграции (последняя строка) ---"
docker compose logs backend 2>&1 | grep -i "pending migrations\|No pending" | tail -1 || true

if [ "$SMOKE" -eq 1 ]; then
  echo "--- smoke: scripts/smoke-telegram-deployment.mjs ---"
  BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:3000}" TG_HOST="$TG_HOST" \
    node scripts/smoke-telegram-deployment.mjs
fi

if [ "$fails" -gt 0 ]; then
  echo "⛔ prod-rebuild: $fails проверок упало"
  exit 1
fi

echo "✅ prod-rebuild: OK ($(date -u +%Y-%m-%dT%H:%M:%SZ))"
