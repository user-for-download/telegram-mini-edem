import { z } from "zod";

/**
 * События, которые сервер отправляет клиенту через WebSocket.
 *
 * Держите в синхроне с backend/src/services/wsManager.ts и
 * backend/src/ws/index.ts: сервер шлёт auth:ok, ping (keep-alive)
 * и бизнес-события. Серверных `pong`/`error` не существует —
 * клиент отвечает на ping сам, ошибки доставляются кодом закрытия.
 */
export const wsServerEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth:ok") }),
  z.object({ type: z.literal("ping") }),
  z.object({
    type: z.literal("booking:new"),
    payload: z.object({ bookingId: z.string(), tripId: z.string() }),
  }),
  z.object({
    type: z.literal("booking:status_changed"),
    payload: z.object({ bookingId: z.string(), tripId: z.string(), status: z.string() }),
  }),
  z.object({
    type: z.literal("trip:status_changed"),
    payload: z.object({ tripId: z.string(), status: z.string() }),
  }),
  z.object({
    type: z.literal("trip:details_changed"),
    payload: z.object({ tripId: z.string() }),
  }),
  z.object({
    type: z.literal("notification:new"),
    payload: z.object({ id: z.string() }),
  }),
]);

export type WsServerEvent = z.infer<typeof wsServerEventSchema>;

/**
 * Sentinel id for the `notification:new` inbox-refresh hint.
 *
 * The payload carries no real notification id: clients ignore the content
 * and treat any `notification:new` as "refetch inbox + unread counter".
 * Call sites must use this constant instead of a magic `{ id: "refresh" }`.
 */
export const NOTIFICATION_HINT_REFRESH_ID = "refresh" as const;

/**
 * Сообщения от клиента к серверу.
 *
 * Сервер принимает только auth и pong (ответ на keep-alive ping).
 * Клиентский ping не поддерживается — keep-alive инициирует сервер.
 */
export const wsClientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("auth"),
    token: z.string().min(1),
  }),
  z.object({
    type: z.literal("pong"),
  }),
]);

export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;
