// backend/src/workers/notificationDispatcher.ts
//
// Outbox-диспетчер фоновых доставок (bot-api shadow mode, §4.3).
//
// Цикл: pollOnce() атомарно забирает пачку pending-задач (status flip
// pending -> processing, условие nextAttemptAt <= now), для каждой:
// 1) перечитает kill-switch и свежую строку пользователя (согласие и
//    тумблер проверяются В МОМЕНТ обработки, не при enqueue — отзыв
//    /stop или выключение тумблера действует немедленно);
// 2) per-user rate limit (optional ≤ N/час, critical ≤ 1/5мин на тип)
//    — при превышении задача остаётся pending с nextAttemptAt в конце
//    окна, попыткой не считается;
// 3) shadow-«доставка»: внешний вызов Bot API ЗАБЛОКИРОВАН (ADR
//    telegram-notification-delivery), поэтому успех разметается как
//    status='delivered', error='shadow' — явный признак того, что
//    сообщения не уходило. При аппруве канала сюда встанет реальный
//    sendMessage без смены контракта outbox.
//
// Ретраи: непредвиденная ошибка -> attempts+1, бэкофф 1м/5м/15м,
// после MAX_RETRIES -> failed. Логи: userId+type+outcome, без body/PII.
//
// Воркер НЕ автозапускается: start() вызывается явно (index.ts на
// проде/деве), тесты зовут pollOnce() напрямую.
import { db } from "../db.js";
import { env } from "../env.js";
import { logger } from "../logger.js";
import {
  decideTelegramDelivery,
  TELEGRAM_CRITICAL_TYPES,
} from "../services/telegramNotifications.js";

/** Захваченная outbox-задача с полями, нужными диспетчеру. */
interface ClaimedDelivery {
  id: string;
  userId: string;
  type: string;
  attempts: number;
}

/** Бэкофф ретраев после каждой неудачной попытки (мс). */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

/** Сколькими записями rate-лимит делит окно (слоты, без памяти-таблиц). */
const RATE_WINDOW_SLOTS = 12;

export interface DispatcherDeps {
  now?: () => Date;
}

/** Атомарный захват пачки pending-задач (pending -> processing). */
async function claimPendingBatch(now: Date): Promise<ClaimedDelivery[]> {
  return db.notificationDelivery.updateManyAndReturn({
    where: {
      status: "pending",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    data: { status: "processing" },
    limit: env.TG_NOTIFICATION_DISPATCH_BATCH_SIZE,
    select: { id: true, userId: true, type: true, attempts: true },
  });
}

/** Сколько доставок канала уже было у пользователя в окне (по статусу). */
async function countRecentDelivered(
  userId: string,
  sinceMs: number,
  now: number,
): Promise<number> {
  return db.notificationDelivery.count({
    where: {
      userId,
      channel: "telegram",
      status: "delivered",
      updatedAt: { gte: new Date(now - sinceMs) },
    },
  });
}

/** Недавняя delivered-доставка того же критичного типа (cooldown-окно). */
async function hasRecentCriticalOfType(
  userId: string,
  type: string,
  cooldownMs: number,
  now: number,
): Promise<boolean> {
  const recent = await db.notificationDelivery.findFirst({
    where: {
      userId,
      channel: "telegram",
      type,
      status: "delivered",
      updatedAt: { gte: new Date(now - cooldownMs) },
    },
    select: { id: true },
  });
  return recent !== null;
}

export interface RateDecision {
  allowed: boolean;
  /** Момент, когда лимит можно будет пересчитать (для nextAttemptAt). */
  retryAt: Date | null;
}

/**
 * Rate limit: optional ≤ TG_NOTIFICATION_USER_RATE_MAX за окно,
 * critical ≤ 1 за cooldown на тип. Считаем по delivered-записям —
 * единый источник истины, переживает рестарт процесса.
 */
async function checkRateLimit(
  userId: string,
  type: string,
  now: Date,
): Promise<RateDecision> {
  const nowMs = now.getTime();
  if (TELEGRAM_CRITICAL_TYPES.has(type)) {
    const cooldown = env.TG_NOTIFICATION_CRITICAL_TYPE_COOLDOWN_MS;
    const blocked = await hasRecentCriticalOfType(userId, type, cooldown, nowMs);
    if (blocked) {
      return { allowed: false, retryAt: new Date(nowMs + cooldown) };
    }
    return { allowed: true, retryAt: null };
  }
  const delivered = await countRecentDelivered(
    userId,
    env.TG_NOTIFICATION_USER_RATE_WINDOW_MS,
    nowMs,
  );
  if (delivered >= env.TG_NOTIFICATION_USER_RATE_MAX) {
    // Равномерный ретрай внутри окна: не позже его конца.
    const windowMs = env.TG_NOTIFICATION_USER_RATE_WINDOW_MS;
    const slot = Math.max(windowMs / RATE_WINDOW_SLOTS, 1);
    return { allowed: false, retryAt: new Date(nowMs + slot) };
  }
  return { allowed: true, retryAt: null };
}

/** Финальная разметка задачи (терминальные статусы и возврат в очередь). */
async function settleDelivery(
  delivery: ClaimedDelivery,
  status: "delivered" | "skipped" | "failed" | "pending",
  error: string | null,
  nextAttemptAt: Date | null = null,
): Promise<void> {
  await db.notificationDelivery.update({
    where: { id: delivery.id },
    data: {
      status,
      error,
      nextAttemptAt,
      // attempts растёт только на ошибки/ретраи, не на rate-defer.
      ...(status === "failed" || (status === "pending" && error)
        ? { attempts: delivery.attempts + 1 }
        : {}),
    },
  });
}

/** Обработка одной захваченной задачи. Никогда не бросает наружу. */
async function processDelivery(delivery: ClaimedDelivery, now: Date): Promise<void> {
  try {
    // 1) Kill-switch: гасит всё мгновенно, без чтения пользователя.
    if (!env.TELEGRAM_DELIVERY_ENABLED) {
      await settleDelivery(delivery, "skipped", "channel_disabled");
      logger.debug(
        { userId: delivery.userId, type: delivery.type, outcome: "channel_disabled" },
        "tg_dispatch_skipped",
      );
      return;
    }

    // 2) Свежая строка пользователя: отзыв /stop или тумблер действуют
    // немедленно, кэша нет.
    const user = await db.user.findUnique({
      where: { id: delivery.userId },
      select: { notificationsEnabled: true, tgChatJoinedAt: true },
    });
    const policy = decideTelegramDelivery({
      type: delivery.type,
      notificationsEnabled: user?.notificationsEnabled ?? false,
      chatJoined: user?.tgChatJoinedAt != null,
      channelEnabled: true,
    });
    if (!policy.deliver) {
      await settleDelivery(delivery, "skipped", policy.reason);
      logger.debug(
        { userId: delivery.userId, type: delivery.type, outcome: policy.reason },
        "tg_dispatch_skipped",
      );
      return;
    }

    // 3) Rate limit: превышение = отложить, попыткой не считается.
    const rate = await checkRateLimit(delivery.userId, delivery.type, now);
    if (!rate.allowed && rate.retryAt) {
      await settleDelivery(delivery, "pending", null, rate.retryAt);
      logger.debug(
        { userId: delivery.userId, type: delivery.type, outcome: "rate_limited" },
        "tg_dispatch_deferred",
      );
      return;
    }

    // 4) Shadow-доставка: Bot API заблокирован (ADR) — внешнего вызова
    // нет по построению. Разметаем как delivered с маркером shadow,
    // чтобы отличать от будущей реальной отправки.
    await settleDelivery(delivery, "delivered", "shadow");
    logger.debug(
      { userId: delivery.userId, type: delivery.type, outcome: "delivered_shadow" },
      "tg_dispatch_shadow",
    );
  } catch (err) {
    // 5) Непредвиденная ошибка: ретраи с бэкоффом, потом failed.
    const nextAttempt = RETRY_BACKOFF_MS[delivery.attempts] ?? null;
    if (nextAttempt === null || delivery.attempts + 1 >= env.TG_NOTIFICATION_MAX_RETRIES) {
      await settleDelivery(delivery, "failed", "max_retries_exceeded");
      logger.error(
        { userId: delivery.userId, type: delivery.type, outcome: "failed" },
        "tg_dispatch_failed",
      );
      return;
    }
    await settleDelivery(
      delivery,
      "pending",
      "retry",
      new Date(now.getTime() + nextAttempt),
    );
    logger.error(
      { userId: delivery.userId, type: delivery.type, outcome: "retry_scheduled" },
      "tg_dispatch_retry",
    );
  }
}

/**
 * Один тик диспетчера: захватить пачку pending, обработать каждую.
 * Экспортирован отдельно от start/stop — тесты и админ-«прогон» зовут
 * его напрямую без интервального таймера.
 */
export async function pollOnce(deps: DispatcherDeps = {}): Promise<number> {
  const now = deps.now ? deps.now() : new Date();
  const batch = await claimPendingBatch(now);
  if (batch.length === 0) return 0;

  for (const delivery of batch) {
    await processDelivery(delivery, now);
  }
  logger.debug({ claimed: batch.length }, "tg_dispatch_batch_done");
  return batch.length;
}

let workerInterval: NodeJS.Timeout | null = null;
let workerRun: Promise<unknown> | null = null;

function runDispatcherCycle(): void {
  if (workerRun) return;
  workerRun = pollOnce().finally(() => {
    workerRun = null;
  });
}

export function startNotificationDispatcher(): void {
  if (workerInterval) return;
  runDispatcherCycle();
  workerInterval = setInterval(
    runDispatcherCycle,
    env.TG_NOTIFICATION_DISPATCH_INTERVAL_MS,
  );
  workerInterval.unref?.();
  logger.info("Notification outbox dispatcher started (shadow mode)");
}

export function stopNotificationDispatcher(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("Notification outbox dispatcher stopped");
  }
}
