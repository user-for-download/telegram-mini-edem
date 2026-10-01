// backend/src/services/notification.service.ts
//
// Создание inbox-уведомлений + постановка фоновой доставки в outbox
// (bot-api shadow mode, approval-package §4.3).
//
// Контракт:
// - inbox-запись создаётся как раньше (critical всегда, optional по
//   тумблеру, TG-пользователи — с дедупликацией);
// - после записи в БД кладём задачу в NotificationDelivery:
//   policy (decideTelegramDelivery) → duplicate → enqueue;
// - решение о политике фиксируется в outbox НЕ в момент отправки:
//   согласие/kill-switch диспетчер перечитывает на месте (см. 05),
//   здесь только предварительная разметка skip-причин;
// - ошибка enqueue НЕ откатывает inbox (try/catch изолирован);
// - внешних вызовов нет — Bot API заблокирован (ADR).
import { db } from "../db.js";
import { logger } from "../logger.js";
import { env } from "../env.js";
import {
  decideTelegramDelivery,
  findNotificationDuplicate,
  resolveTelegramDeepLink,
  TELEGRAM_CRITICAL_TYPES,
} from "./telegramNotifications.js";

/** Записать задачу фоновой доставки в outbox. Никогда не бросает. */
async function enqueueDelivery(input: {
  notificationId: string;
  userId: string;
  type: string;
  fragment?: string;
}): Promise<void> {
  try {
    await db.notificationDelivery.create({
      data: {
        notificationId: input.notificationId,
        userId: input.userId,
        channel: "telegram",
        type: input.type,
        status: "pending",
        deepLink: resolveTelegramDeepLink(input.fragment),
      },
    });
    logger.debug(
      { userId: input.userId, type: input.type },
      "tg_outbox_enqueued",
    );
  } catch (error) {
    // Inbox уже создан и виден пользователю — откатывать нельзя.
    // Потеря задачи фоновой доставки допустима (канал вспомогательный).
    logger.error(
      { err: error, userId: input.userId, type: input.type },
      "tg_outbox_enqueue_failed",
    );
  }
}

/** Разметить отказ фоновой доставки в outbox (skip с причиной). */
async function recordSkippedDelivery(input: {
  notificationId: string;
  userId: string;
  type: string;
  reason: string;
}): Promise<void> {
  try {
    await db.notificationDelivery.create({
      data: {
        notificationId: input.notificationId,
        userId: input.userId,
        channel: "telegram",
        type: input.type,
        status: "skipped",
        error: input.reason,
      },
    });
  } catch (error) {
    logger.error(
      { err: error, userId: input.userId, type: input.type },
      "tg_outbox_skip_record_failed",
    );
  }
}

/** Снапшот поездки для третьей строки ячейки инбокса. */
export interface NotificationTripSnapshot {
  from: string;
  to: string;
  price: number;
  departureAt: Date;
}

/**
 * Собрать снапшот из trip-строки (имена полей — как в Prisma Trip).
 * Вызывающие передают уже загруженный объект, отдельных запросов нет.
 */
export function tripSnapshotOf(trip: {
  fromCity: string;
  toCity: string;
  price: number;
  departureAt: Date;
}): NotificationTripSnapshot {
  return {
    from: trip.fromCity,
    to: trip.toCity,
    price: trip.price,
    departureAt: trip.departureAt,
  };
}

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  /** Deep-link (маршрут Telegram-приложения) для tap-destination уведомления. */
  fragment?: string,
  /** Отображаемое имя второй стороны (вторая строка ячейки инбокса). */
  actorName?: string,
  /** Машинный код действия (третья строка ячейки, client map). */
  action?: string,
  /** Снапшот поездки для третьей строки («дата • цена • маршрут»). */
  tripSnapshot?: NotificationTripSnapshot,
  /** Возвращает id созданной записи; null — пропуск (тумблер/дедуп) или сбой. */
): Promise<string | null> {
  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return null;
    // Критичные уведомления создаются независимо от тумблера.
    // Некритичные (booking_created, trip_details_changed и др.)
    // подчиняются настройкам пользователя.
    // Критичные типы — единый источник CRITICAL_NOTIFICATION_TYPES
    // в @edem/contracts (там же клиент; комментарий о бизнес-контракте
    // см. в telegramNotifications.ts): создаются в БД всегда,
    // даже если пользователь выключил общий тумблер.
    const isCritical = TELEGRAM_CRITICAL_TYPES.has(type);
    if (!user.notificationsEnabled && !isCritical) return null;

    // Дедуп: повтор того же события внутри окна не плодит записи.
    // Для всех пользователей, не только TG: повторный прогон воркера
    // иначе дублирует и остальным (m9).
    const duplicate = await findNotificationDuplicate({
      userId,
      type,
      title,
      body,
    });
    if (duplicate) {
      logger.debug({ userId, type }, "notification_duplicate_skipped");
      return null;
    }

    const notification = await db.notification.create({
      data: {
        userId,
        type,
        title,
        body,
        // Allowlist-маршрут для тапа по инбокс-уведомлению (тот же
        // резолвер, что у фоновой доставки): /trips/<uuid> и т.п.
        // Без fragment — null, клиент берёт fallback-карту по type
        // (а не безопасный /notifications, который бы её перекрыл).
        deepLink: fragment ? resolveTelegramDeepLink(fragment) : null,
        actorName: actorName ?? null,
        action: action ?? null,
        tripFrom: tripSnapshot?.from ?? null,
        tripTo: tripSnapshot?.to ?? null,
        tripPrice: tripSnapshot?.price ?? null,
        tripDepartureAt: tripSnapshot?.departureAt ?? null,
      },
    });

    // Фоновая доставка (outbox): только для TG-пользователей. Политика
    // решает enqueue (pending) или сразу skipped с причиной; диспетчер
    // перечитает kill-switch/согласие/лимиты в момент обработки.
    const isTelegramUser = user.telegramUserId != null;
    if (!isTelegramUser) return notification.id;
    const policy = decideTelegramDelivery({
      type,
      notificationsEnabled: user.notificationsEnabled,
      chatJoined: user.tgChatJoinedAt != null,
      channelEnabled: env.TELEGRAM_DELIVERY_ENABLED,
    });
    if (!policy.deliver) {
      await recordSkippedDelivery({
        notificationId: notification.id,
        userId,
        type,
        reason: policy.reason,
      });
      logger.debug(
        { userId, type, reason: policy.reason },
        "tg_outbox_skip_policy",
      );
      return notification.id;
    }
    await enqueueDelivery({ notificationId: notification.id, userId, type, fragment });
    return notification.id;
  } catch (error) {
    logger.error({ err: error }, "Failed to create notification");
    return null;
  }
}
