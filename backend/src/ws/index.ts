import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import { verifyAccessTokenClaims } from "../auth/tokens.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { wsManager } from "../services/wsManager.js";
import { logger } from "../logger.js";
import { wsClientMessageSchema } from "@edem/contracts";

/**
 * connId, привязанный к сокету в onOpen. WSContext — чужой интерфейс без
 * нашего поля, поэтому читаем/пишем через узкий каст вместо any.
 * Неизвестный сокет (onOpen не отработал) — undefined, вызывающий решает.
 */
function getConnId(ws: WSContext): string | undefined {
  return (ws as unknown as { __connId?: unknown }).__connId as
    | string
    | undefined;
}

function setConnId(ws: WSContext, connId: string): void {
  (ws as unknown as { __connId?: unknown }).__connId = connId;
}

/**
 * IP клиента для WS-лимитов (per-IP cap + auth throttle).
 * Та же политика, что в middleware/rateLimit.ts resolveClientIp:
 * за доверенным прокси — из перезаписанных прокси заголовков,
 * при прямом подключении — из TCP-сокета (неподделываемый).
 * Заголовкам без доверенного прокси не верим → "unknown".
 */
function resolveWsClientIp(c: Context): string {
  if (env.TRUST_PROXY) {
    const realIp =
      c.req.header("x-real-ip") ||
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (realIp) return realIp;
  } else {
    try {
      const address = getConnInfo(c).remote.address;
      if (address) return address;
    } catch {
      // getConnInfo недоступен (тесты) — ниже fallback "unknown".
    }
  }
  return "unknown";
}

export function createWsHandler(upgradeWebSocket: UpgradeWebSocket) {
  return upgradeWebSocket((c: Context) => {
    // IP фиксируем на upgrade: дальше соединение живёт вне HTTP-контекста.
    const clientIp = resolveWsClientIp(c);
    // Параметры хендлеров типизируются контекстно из UpgradeWebSocket
    // (в backend-tsconfig нет DOM-библиотеки — Event/MessageEvent вслух
    // не называем; ws — WSContext<unknown>).
    return {
      onOpen(_evt, ws) {
        // @hono/node-ws всегда кладёт ws-сокет — приводим раз, в одном
        // месте, вместо any на каждом вызове.
        const connId = wsManager.register(
          ws as WSContext<WebSocket>,
          clientIp,
        );
        setConnId(ws, connId);
      },

      async onMessage(evt, ws) {
        const connId = getConnId(ws);
        if (!connId) return;

        // Per-connection message rate cap — ДО JSON.parse: флуд мусором
        // тоже считается. Throttled → закрываем кодом 1013.
        if (!wsManager.recordMessage(connId)) {
          logger.warn({ connId }, "ws_message_rate_exceeded");
          wsManager.close(connId, 1013, "Too many messages");
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(String(evt.data));
        } catch {
          logger.warn({ connId }, "ws_invalid_json");
          wsManager.close(connId, 1003, "Invalid JSON");
          return;
        }

        const result = wsClientMessageSchema.safeParse(parsed);
        if (!result.success) {
          logger.warn({ connId }, "ws_unknown_message_type");
          return;
        }

        const msg = result.data;

        if (msg.type === "pong") {
          wsManager.handlePong(connId);
          return;
        }

        if (msg.type === "auth") {
          // Auth handshake throttle — ДО jwtVerify+DB, чтобы анонимный
          // флуд не усиливался криптографией и запросами в БД.
          if (!wsManager.recordAuthAttempt(connId)) {
            logger.warn({ connId }, "ws_auth_throttled");
            wsManager.close(connId, 1013, "Too many auth attempts");
            return;
          }
          try {
            const { userId, expiresAt } = await verifyAccessTokenClaims(
              msg.token,
            );

            // JWT stateless и не знает о бане: проверяем пользователя в БД.
            // Забаненный не аутентифицируется — закрываем соединение с 4403.
            const dbUser = await db.user.findUnique({
              where: { id: userId },
              select: { bannedAt: true, deletedAt: true },
            });

            if (!dbUser) {
              logger.warn({ connId, userId }, "ws_auth_user_not_found");
              wsManager.close(connId, 4401, "User not found");
              return;
            }

            if (dbUser.deletedAt) {
              logger.warn({ connId, userId }, "ws_auth_user_deleted");
              wsManager.close(connId, 4403, "Account is deleted");
              return;
            }

            if (dbUser.bannedAt) {
              logger.warn({ connId, userId }, "ws_auth_user_banned");
              wsManager.close(connId, 4403, "Account is banned");
              return;
            }

            const ok = wsManager.authenticate(connId, userId, expiresAt);
            // authenticate() возвращает false только если соединение уже
            // принадлежит ДРУГОМУ пользователю (повторная auth тем же
            // пользователем идемпотентна и возвращает true).
            if (!ok) {
              wsManager.close(
                connId,
                4401,
                "Already authenticated as another user",
              );
            } else {
              ws.send(JSON.stringify({ type: "auth:ok" }));
            }
          } catch {
            logger.warn({ connId }, "ws_auth_failed");
            wsManager.close(connId, 4401, "Invalid token");
          }
        }
      },

      onClose(_evt, ws) {
        const connId = getConnId(ws);
        if (connId) wsManager.close(connId);
      },

      onError(evt, ws) {
        const connId = getConnId(ws);
        logger.error({ connId, evt }, "ws_error");
        if (connId) wsManager.close(connId, 1011, "Error");
      },
    };
  });
}
