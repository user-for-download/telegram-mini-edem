// backend/src/services/telegramMetrics.ts
//
// Агрегаты outbox-доставок для наблюдаемости (bot-api shadow,
// approval-package §4.6): счётчики по status/error из NotificationDelivery.
//
// Чистая читающая агрегация groupBy: без PII (только counts), без тел
// сообщений. Вызывается из /metrics (Prometheus-снимок) и доступна
// админ-панели. Kill-switch отражается как отдельное поле канала.
import { db } from "../db.js";
import { env } from "../env.js";

export interface TelegramDeliveryMetrics {
  /** Канал жив? (TELEGRAM_DELIVERY_ENABLED). */
  channelEnabled: boolean;
  /** Всего задач в outbox (любой статус). */
  total: number;
  /** pending — ждут обработки (включая deferred rate-limit). */
  pending: number;
  /** processing — прямо сейчас в воркере. */
  processing: number;
  /** delivered, включая shadow-маркер. */
  delivered: number;
  /** delivered с error='shadow' — размечено без внешней отправки. */
  deliveredShadow: number;
  /** failed после исчерпания ретраев. */
  failed: number;
  /** skipped по причинам (каналы отказа). */
  skipped: Record<string, number>;
}

type StatusCount = { status: string; error: string | null; count: bigint };

/** Считает агрегаты из outbox-таблицы. Малые функции, без побочных эффектов. */
export async function getTelegramDeliveryMetrics(): Promise<TelegramDeliveryMetrics> {
  const groups = await db.notificationDelivery.groupBy({
    by: ["status", "error"],
    _count: { _all: true },
  });

  return foldGroups(
    groups.map((g) => ({
      status: g.status,
      error: g.error,
      count: BigInt(g._count._all),
    })),
    env.TELEGRAM_DELIVERY_ENABLED,
  );
}

/** Чистая свёртка групп в метрики (тестируется без БД). */
export function foldGroups(
  groups: StatusCount[],
  channelEnabled: boolean,
): TelegramDeliveryMetrics {
  const metrics: TelegramDeliveryMetrics = {
    channelEnabled,
    total: 0,
    pending: 0,
    processing: 0,
    delivered: 0,
    deliveredShadow: 0,
    failed: 0,
    skipped: {},
  };
  for (const g of groups) {
    const count = Number(g.count);
    metrics.total += count;
    switch (g.status) {
      case "pending":
      case "processing":
        metrics[g.status] += count;
        break;
      case "delivered":
        metrics.delivered += count;
        if (g.error === "shadow") metrics.deliveredShadow += count;
        break;
      case "failed":
        metrics.failed += count;
        break;
      case "skipped":
        metrics.skipped[g.error ?? "unknown"] =
          (metrics.skipped[g.error ?? "unknown"] ?? 0) + count;
        break;
      default:
        break;
    }
  }
  return metrics;
}

/** Prometheus text-представление (добавляется в общий снимок /metrics). */
export function renderTelegramMetrics(m: TelegramDeliveryMetrics): string {
  const lines = [
    `# HELP tg_outbox_channel_enabled Whether Telegram delivery channel is enabled (kill-switch).`,
    `# TYPE tg_outbox_channel_enabled gauge`,
    `tg_outbox_channel_enabled ${m.channelEnabled ? 1 : 0}`,
    `# HELP tg_outbox_total Total notification delivery tasks in outbox.`,
    `# TYPE tg_outbox_total counter`,
    `tg_outbox_total ${m.total}`,
    `# HELP tg_outbox_status Tasks by status.`,
    `# TYPE tg_outbox_status gauge`,
    `tg_outbox_status{status="pending"} ${m.pending}`,
    `tg_outbox_status{status="processing"} ${m.processing}`,
    `tg_outbox_status{status="delivered"} ${m.delivered}`,
    `tg_outbox_status{status="failed"} ${m.failed}`,
    `# HELP tg_outbox_delivered_shadow Deliveries marked without external send (shadow mode).`,
    `# TYPE tg_outbox_delivered_shadow counter`,
    `tg_outbox_delivered_shadow ${m.deliveredShadow}`,
  ];
  for (const [reason, count] of Object.entries(m.skipped)) {
    lines.push(`tg_outbox_skipped{reason="${reason}"} ${count}`);
  }
  if (Object.keys(m.skipped).length > 0) {
    lines.unshift(
      `# HELP tg_outbox_skipped Skipped delivery tasks by reason.`,
      `# TYPE tg_outbox_skipped gauge`,
    );
  }
  return lines.join("\n") + "\n";
}
