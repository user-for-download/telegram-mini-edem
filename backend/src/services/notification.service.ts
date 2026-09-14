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
  findTelegramDuplicate,
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

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  /** Deep-link (маршрут Telegram-приложения) для tap-destination уведомления. */
  fragment?: string
) {
  try {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) return;
    // Критичные уведомления создаются независимо от тумблера.
    // Некритичные (booking_created, trip_details_changed и др.)
    // подчиняются настройкам пользователя.
    // Критичные типы — единый источник в telegramNotifications.ts
    // (комментарий о бизнес-контракте см. там): создаются в БД всегда,
    // даже если пользователь выключил общий тумблер.
    const isCritical = TELEGRAM_CRITICAL_TYPES.has(type);
    if (!user.notificationsEnabled && !isCritical) return;

    // Дедуп: повтор того же события внутри окна не плодит записи.
    const isTelegramUser = user.telegramUserId != null;
    if (isTelegramUser) {
      const duplicate = await findTelegramDuplicate({
        userId,
        type,
        title,
        body,
      });
      if (duplicate) {
        logger.debug({ userId, type }, "tg_notification_duplicate_skipped");
        return;
      }
    }

    const notification = await db.notification.create({
      data: { userId, type, title, body },
    });

    // Фоновая доставка (outbox): только для TG-пользователей. Политика
    // решает enqueue (pending) или сразу skipped с причиной; диспетчер
    // перечитает kill-switch/согласие/лимиты в момент обработки.
    if (!isTelegramUser) return;
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
      return;
    }
    await enqueueDelivery({ notificationId: notification.id, userId, type, fragment });
  } catch (error) {
    logger.error({ err: error }, "Failed to create notification");
  }
}
