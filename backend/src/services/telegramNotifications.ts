// backend/src/services/telegramNotifications.ts
//
// Политика и helpers TG-доставки уведомлений (Bot API approved 2026-09-14,
// ADR telegram-notification-delivery).
//
// Утверждённый механизм: персистентный in-app inbox + WebSocket как
// foreground-hint + фоновый outbox-диспетчер (notificationDispatcher):
// при TELEGRAM_BOT_TOKEN — реальный sendMessage, без токена —
// skipped/no_token без внешних вызовов.
//
// Ответственность модуля:
// - `shouldDeliverTelegram` — чистая политика opt-out / critical override;
// - `decideTelegramDelivery` — чистая политика с согласием (/start) и
//   kill-switch;
// - `resolveTelegramDeepLink` — чистый allowlist TG-маршрутов, всё
//   неизвестное схлопывается в безопасный `/notifications`;
// - `findNotificationDuplicate` — защита от двойной доставки одного и того же
//   события (повторный прогон воркера): одинаковые user+type+title+body
//   внутри окна дедупликации.
import { db } from "../db.js";
import { env } from "../env.js";
import { CRITICAL_NOTIFICATION_TYPES } from "@edem/contracts";

/**
 * Критичные типы: персистятся независимо от пользовательского тумблера.
 * Алиас единого источника из @edem/contracts (там же — клиент и тесты
 * контракта; локальных дублирующих сетов быть не должно).
 */
export const TELEGRAM_CRITICAL_TYPES: ReadonlySet<string> =
  CRITICAL_NOTIFICATION_TYPES;

/** Безопасный фолбэк: входная точка inbox, существует всегда. */
export const TELEGRAM_FALLBACK_ROUTE = "/notifications";

/**
 * Allowlist реализованных маршрутов telegram-app (см. AppRouter).
 * Параметризованные маршруты поездок — только с UUID-идентификатором:
 * никаких сырых пользовательских данных, токенов и query в deep-link.
 */
const TELEGRAM_EXACT_ROUTES: ReadonlySet<string> = new Set([
  "/trips",
  "/trips/my",
  "/trips/my/new",
  "/bookings",
  "/bookings/history",
  "/ride-requests",
  "/profile",
  "/reviews",
  "/settings",
  "/notifications",
  "/profile/support",
  "/profile/reports",
  "/vehicle",
]);

const UUID_RE =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const TRIP_DETAILS_RE = /^\/trips\/([^/]+)$/;
const TRIP_REQUESTS_RE = /^\/trips\/my\/([^/]+)\/requests$/;

export interface TelegramDeliveryPolicyInput {
  type: string;
  /** Пользовательский тумблер «Уведомления» (единый на оба канала). */
  notificationsEnabled: boolean;
  /** Факт /start в чате с ботом (User.tgChatJoinedAt != null). */
  chatJoined: boolean;
  /** Kill-switch TELEGRAM_DELIVERY_ENABLED (гасит весь канал). */
  channelEnabled?: boolean;
}

/** Почему доставка не состоялась — машинный код для outbox/логов. */
export type TelegramSkipReason =
  | "channel_disabled"
  | "no_chat"
  | "notifications_disabled";

export type TelegramPolicyDecision =
  | { deliver: true }
  | { deliver: false; reason: TelegramSkipReason };

/**
 * Чистая функция: полная политика фоновой TG-доставки
 * (bot-api-approval-package §2):
 * - kill-switch выключен → channel_disabled (ничего не доставляем);
 * - чата с ботом нет → no_chat (тихо, независимо от критичности —
 *   бот не может написать первым без /start);
 * - critical игнорирует выключенный тумблер;
 * - optional подчиняется настройке пользователя.
 */
export function decideTelegramDelivery(
  input: TelegramDeliveryPolicyInput,
): TelegramPolicyDecision {
  if (input.channelEnabled === false) {
    return { deliver: false, reason: "channel_disabled" };
  }
  if (!input.chatJoined) {
    return { deliver: false, reason: "no_chat" };
  }
  if (TELEGRAM_CRITICAL_TYPES.has(input.type)) return { deliver: true };
  if (!input.notificationsEnabled) {
    return { deliver: false, reason: "notifications_disabled" };
  }
  return { deliver: true };
}

/**
 * Чистая функция: critical игнорирует выключенный тумблер,
 * остальные типы подчиняются настройке пользователя.
 */
export function shouldDeliverTelegram(
  type: string,
  notificationsEnabled: boolean,
): boolean {
  if (TELEGRAM_CRITICAL_TYPES.has(type)) return true;
  return notificationsEnabled;
}

/**
 * Чистая функция: валидирует deep-link от вызывающего кода.
 * Пустой/неизвестный/подозрительный (query, hash, пробелы) —
 * в безопасный фолбэк inbox.
 */
export function resolveTelegramDeepLink(fragment?: string): string {
  if (!fragment || typeof fragment !== "string") {
    return TELEGRAM_FALLBACK_ROUTE;
  }
  if (
    fragment.includes("?") ||
    fragment.includes("#") ||
    fragment.includes("@") ||
    /\s/.test(fragment)
  ) {
    return TELEGRAM_FALLBACK_ROUTE;
  }
  if (TELEGRAM_EXACT_ROUTES.has(fragment)) {
    return fragment;
  }
  const details = TRIP_DETAILS_RE.exec(fragment);
  if (details && UUID_RE.test(details[1])) {
    return fragment;
  }
  const requests = TRIP_REQUESTS_RE.exec(fragment);
  if (requests && UUID_RE.test(requests[1])) {
    return fragment;
  }
  return TELEGRAM_FALLBACK_ROUTE;
}

export interface TelegramDuplicateInput {
  userId: string;
  type: string;
  title: string;
  body: string;
}

/**
 * Ищет идентичную запись того же пользователя/события/текста,
 * созданную внутри окна дедупликации. Легитимные разные события
 * отличаются текстом (город/дата/маршрут), поэтому не подавляются.
 * Для всех пользователей, не только TG (m9): повторный прогон воркера
 * иначе дублирует inbox остальным.
 */
export async function findNotificationDuplicate(
  input: TelegramDuplicateInput,
  windowMs: number = env.TG_NOTIFICATION_DEDUPE_WINDOW_MS,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs);
  const existing = await db.notification.findFirst({
    where: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      createdAt: { gte: since },
    },
    select: { id: true },
  });
  return existing !== null;
}
