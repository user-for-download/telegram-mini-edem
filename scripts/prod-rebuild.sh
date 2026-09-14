#!/bin/sh
# Прод-режим: чистка docker-мусора (иначе no-cache сборки забивают диск —
# было 99%), no-cache сборка backend+webapp, пересоздание, health-check.
# Использование: sh scripts/prod-rebuild.sh
set -eu

docker builder prune -af
docker image prune -af
docker compose build --no-cache backend webapp
docker compose up -d --force-recreate backend webapp
sleep 10
echo "--- health ---"
curl -sf http://127.0.0.1:3000/health/ready; echo
curl -s -o /dev/null -w "live:%{http_code}\n" http://127.0.0.1:3000/health/live
curl -s -o /dev/null -w "webapp:%{http_code}\n" http://127.0.0.1:3014/
curl -s -o /dev/null -w "tg-host:%{http_code}\n" -H "Host: tg-edem.biet.site" http://127.0.0.1:3000/
docker compose logs backend 2>&1 | grep -i "pending migrations\|No pending" | tail -1
