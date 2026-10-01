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
import {
  sendTelegramMessage,
  type SendOutcome,
} from "../services/telegramSend.js";

/** Захваченная outbox-задача с полями, нужными диспетчеру. */
interface ClaimedDelivery {
  id: string;
  notificationId: string;
  userId: string;
  type: string;
  attempts: number;
  deepLink: string | null;
}

/** Бэкофф ретраев после каждой неудачной попытки (мс). */
const RETRY_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

/** Сколькими записями rate-лимит делит окно (слоты, без памяти-таблиц). */
const RATE_WINDOW_SLOTS = 12;

export interface DispatcherDeps {
  now?: () => Date;
}

/** Зависшая processing-запись, кандидат на восстановление. */
interface StuckDelivery {
  id: string;
  attempts: number;
}

/**
 * Чистое разделение зависших записей: исчерпавшие ретраи — в failed,
 * остальные — обратно в очередь. attempts+1 >= maxRetries — порог
 * совпадает с retryOrFail/processDelivery (включая текущую попытку).
 */
function splitStuckForRecovery(
  stuck: readonly StuckDelivery[],
  maxRetries: number,
): { retryIds: string[]; failIds: string[] } {
  const retryIds: string[] = [];
  const failIds: string[] = [];
  for (const row of stuck) {
    if (row.attempts + 1 >= maxRetries) failIds.push(row.id);
    else retryIds.push(row.id);
  }
  return { retryIds, failIds };
}

/**
 * Восстановление зависших processing-записей (краш/рестарт посреди
 * батча): updatedAt старше TG_NOTIFICATION_PROCESSING_TIMEOUT_MS —
 * обратно в pending с очищенным nextAttemptAt (забираемы сразу же в
 * этом тике) и attempts+1; исчерпавшие лимит — в failed. Свежие
 * processing-строки фильтр updatedAt не затрагивает никогда.
 * Логи — только машинные коды и счётчики, без body/PII.
 */
async function recoverStuckProcessing(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - env.TG_NOTIFICATION_PROCESSING_TIMEOUT_MS);
  const stuck = await db.notificationDelivery.findMany({
    where: { status: "processing", updatedAt: { lt: cutoff } },
    select: { id: true, attempts: true },
  });
  if (stuck.length === 0) return;
  const { retryIds, failIds } = splitStuckForRecovery(stuck, env.TG_NOTIFICATION_MAX_RETRIES);
  if (retryIds.length > 0) {
    await db.notificationDelivery.updateMany({
      where: { id: { in: retryIds } },
      data: {
        status: "pending",
        nextAttemptAt: null,
        attempts: { increment: 1 },
        error: "processing_timeout",
      },
    });
    logger.warn(
      { recovered: retryIds.length, code: "processing_timeout" },
      "tg_dispatch_recovered",
    );
  }
  if (failIds.length > 0) {
    await db.notificationDelivery.updateMany({
      where: { id: { in: failIds } },
      data: {
        status: "failed",
        nextAttemptAt: null,
        attempts: { increment: 1 },
        error: "max_retries_exceeded",
      },
    });
    logger.error(
      { recovered: failIds.length, code: "max_retries_exceeded" },
      "tg_dispatch_recovery_failed",
    );
  }
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
    select: {
      id: true,
      notificationId: true,
      userId: true,
      type: true,
      attempts: true,
      deepLink: true,
    },
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

/**
 * Ретрай-исход: как разметить неудачную реальную отправку (429/сеть/4xx).
 * Возвращает null, если исход терминальный (обработан вызывающим).
 */
async function retryOrFail(
  delivery: ClaimedDelivery,
  code: string,
  retryAfterMs: number | null,
  now: Date,
): Promise<void> {
  const backoff = retryAfterMs ?? RETRY_BACKOFF_MS[delivery.attempts] ?? null;
  if (backoff === null || delivery.attempts + 1 >= env.TG_NOTIFICATION_MAX_RETRIES) {
    await settleDelivery(delivery, "failed", code);
    logger.error(
      { userId: delivery.userId, type: delivery.type, outcome: "failed", code },
      "tg_dispatch_failed",
    );
    return;
  }
  await settleDelivery(delivery, "pending", code, new Date(now.getTime() + backoff));
  logger.error(
    { userId: delivery.userId, type: delivery.type, outcome: "retry_scheduled", code },
    "tg_dispatch_retry",
  );
}

/** Разметить исход реальной отправки (терминальные случаи). */
async function settleSendOutcome(
  delivery: ClaimedDelivery,
  outcome: SendOutcome,
  now: Date,
): Promise<boolean> {
  if (outcome.ok) {
    await settleDelivery(delivery, "delivered", null);
    logger.debug(
      { userId: delivery.userId, type: delivery.type, outcome: "delivered" },
      "tg_dispatch_delivered",
    );
    return true;
  }
  if (outcome.kind === "bot_blocked" || outcome.kind === "chat_not_found") {
    // Терминально, без ретраев: согласие недействительно, чата больше
    // нет — сбрасываем, следующих отправок не будет (ADR). chatId взят
    // из проверенного initData, поэтому «chat not found» означает
    // отсутствие чата/согласия, а не временный сбой.
    await db.user.update({
      where: { id: delivery.userId },
      data: { tgChatJoinedAt: null },
    });
    await settleDelivery(delivery, "skipped", outcome.kind);
    logger.debug(
      { userId: delivery.userId, type: delivery.type, outcome: outcome.kind },
      "tg_dispatch_skipped",
    );
    return true;
  }
  if (outcome.kind === "rate_limited") {
    await retryOrFail(
      delivery,
      "rate_limited",
      outcome.retryAfterMs,
      now,
    );
    return true;
  }
  if (outcome.kind === "permanent") {
    // Одна попытка: 4xx-повтор бессмыслен — сразу failed/bad_request.
    // settleDelivery на failed сам делает attempts+1, retryOrFail не зовём.
    await settleDelivery(delivery, "failed", "bad_request");
    logger.error(
      { userId: delivery.userId, type: delivery.type, outcome: "failed", code: "bad_request" },
      "tg_dispatch_failed",
    );
    return true;
  }
  return false; // transient — вызывающий разметит кодом network_error.
}

/**
 * Реальная отправка: текст = title + "\n\n" + body inbox-уведисления
 * (§6а.4), chatId = telegramUserId, кнопка «Открыть» по deep-link.
 */
async function sendDelivery(
  delivery: ClaimedDelivery,
  telegramUserId: bigint | null,
  now: Date,
): Promise<void> {
  if (telegramUserId === null) {
    // Пользователь без TG-id не должен попадать в outbox; страховка.
    await settleDelivery(delivery, "skipped", "no_chat");
    return;
  }
  const notification = await db.notification.findUnique({
    where: { id: delivery.notificationId },
    select: { title: true, body: true },
  });
  if (!notification) {
    // Inbox-запись удалена пользователем — доставлять нечего.
    await settleDelivery(delivery, "skipped", "notification_deleted");
    return;
  }

  const outcome = await sendTelegramMessage({
    chatId: Number(telegramUserId),
    text: `${notification.title}\n\n${notification.body}`,
    deepLink: delivery.deepLink ?? undefined,
  });
  const settled = await settleSendOutcome(delivery, outcome, now);
  if (!settled) {
    await retryOrFail(delivery, "network_error", null, now);
  }
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
      select: {
        notificationsEnabled: true,
        tgChatJoinedAt: true,
        telegramUserId: true,
      },
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

    // 4) Доставка: без токена — skipped/no_token (внешнего вызова нет);
    //    с токеном — реальный sendMessage (ADR approved 2026-09-14).
    if (!env.TELEGRAM_BOT_TOKEN) {
      await settleDelivery(delivery, "skipped", "no_token");
      logger.debug(
        { userId: delivery.userId, type: delivery.type, outcome: "no_token" },
        "tg_dispatch_skipped",
      );
      return;
    }
    await sendDelivery(delivery, user?.telegramUserId ?? null, now);
  } catch (err) {
    // 5) Непредвиденная ошибка: ретраи с бэкоффом, потом failed.
    const nextAttempt = RETRY_BACKOFF_MS[delivery.attempts] ?? null;
    if (nextAttempt === null || delivery.attempts + 1 >= env.TG_NOTIFICATION_MAX_RETRIES) {
      await settleDelivery(delivery, "failed", "max_retries_exceeded");
      logger.error(
        { err, userId: delivery.userId, type: delivery.type, outcome: "failed" },
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
      { err, userId: delivery.userId, type: delivery.type, outcome: "retry_scheduled" },
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
  await recoverStuckProcessing(now);
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
  if (env.TELEGRAM_DELIVERY_ENABLED && !env.TELEGRAM_BOT_TOKEN) {
    logger.warn({ code: "no_token" }, "tg_dispatch_no_token");
  }
  runDispatcherCycle();
  workerInterval = setInterval(
    runDispatcherCycle,
    env.TG_NOTIFICATION_DISPATCH_INTERVAL_MS,
  );
  workerInterval.unref?.();
  logger.info(
    "Notification outbox dispatcher started (no-token ticks mark skipped/no_token)",
  );
}

export function stopNotificationDispatcher(): void {
  if (workerInterval) {
    clearInterval(workerInterval);
    workerInterval = null;
    logger.info("Notification outbox dispatcher stopped");
  }
}
