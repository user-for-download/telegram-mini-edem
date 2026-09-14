import { initSentry } from "./utils/sentry.js";
import { serve } from "@hono/node-server";
import { app, injectWebSocket } from "./app.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { wsManager, startWsReaper, stopWsReaper } from "./services/wsManager.js";

import { db } from "./db.js";
import { startTripWorker, stopTripWorker } from "./workers/tripWorker.js";
import {
  startNotificationDispatcher,
  stopNotificationDispatcher,
} from "./workers/notificationDispatcher.js";

initSentry();

if (env.isProduction && env.ALLOW_DEV_AUTH) {
  throw new Error(
    "[FATAL] ALLOW_DEV_AUTH is enabled in production. This is a security risk."
  );
}

if (env.ALLOW_DEV_AUTH) {
  logger.warn(
    "DEV auth is enabled (mock tokens & dev-hash accepted). " +
    "Do NOT use in production."
  );
}

logger.info({ port: env.PORT }, "Starting Edem Backend");

const server = serve({
  fetch: app.fetch,
  port: env.PORT,
  hostname: "0.0.0.0",
});

injectWebSocket(server);
logger.info({ port: env.PORT }, "WebSocket support injected");

startTripWorker();
startWsReaper();
// Outbox-диспетчер TG-доставок: shadow mode, внешних вызовов нет (ADR).
startNotificationDispatcher();

const SHUTDOWN_TIMEOUT_MS = 20_000;
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutdown signal received");
  stopTripWorker();
  stopWsReaper();
  stopNotificationDispatcher();
  wsManager.closeAll(1001, "Server shutting down");
  server.close(async () => {
    logger.info("HTTP server closed");
    try {
      await db.$disconnect();
      logger.info("Database connections closed");
    } catch (error) {
      logger.error({ err: error }, "Error closing database connections");
    }
    process.exit(0);
  });
  // close() ждёт завершения keep-alive соединений; idle-сокеты закрываем
  // сразу, чтобы shutdown не висел до forced-exit таймаута.
  // ServerType — union (http.Server | Http2Server | ...), метод есть только
  // на http.Server (Node ≥ 18.2), поэтому вызываем с runtime-проверкой.
  const closeIdleConnections = (
    server as { closeIdleConnections?: () => void }
  ).closeIdleConnections;
  if (typeof closeIdleConnections === "function") {
    closeIdleConnections.call(server);
  }
  setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "Forced shutdown after timeout");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
