// backend/prisma/db-push-guard.ts
//
// Prod-guard для деструктивных `prisma db push --accept-data-loss`
// (зеркалит drop-tables.ts/seed.ts: NODE_ENV=production + явный allow-флаг).
// Запускается npm-скриптом ДО prisma, поэтому выход происходит до любого
// подключения к БД и до любого SQL. Dev/test-flow флагов не требует
// (NODE_ENV там не production). .env грузим сами: Prisma CLI читает его
// отдельно, а guard должен видеть тот же NODE_ENV.
import { config as loadEnv } from "dotenv";

loadEnv({ path: new URL("../.env", import.meta.url) });

if (
  process.env.NODE_ENV === "production" &&
  process.env.ALLOW_PRODUCTION_DB_PUSH !== "true"
) {
  console.error(
    "[db-push-guard] Refusing `prisma db push --accept-data-loss` in production. " +
      "Set ALLOW_PRODUCTION_DB_PUSH=true to override (may destroy data).",
  );
  process.exit(1);
}
