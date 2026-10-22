import type { AdminTelegramMetricsDto } from "@edem/contracts";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useTelegramMetricsQuery } from "./queries";

type CounterKey = "total" | "pending" | "processing" | "delivered" | "failed";

const COUNTERS: ReadonlyArray<{ key: CounterKey; label: string }> = [
  { key: "total", label: "Всего задач" },
  { key: "pending", label: "Ожидают" },
  { key: "processing", label: "В обработке" },
  { key: "delivered", label: "Доставлено" },
  { key: "failed", label: "Ошибки" },
];

/**
 * Причины skip из backend/src/services/telegramNotifications.ts и воркера.
 * Неизвестный код показываем как есть: это техническая причина, не PII.
 */
const SKIPPED_REASON_LABELS: Readonly<Record<string, string>> = {
  channel_disabled: "Канал отключён",
  no_chat: "Нет чата с ботом",
  notifications_disabled: "Уведомления выключены",
  no_token: "Нет токена бота",
  admin_stopped: "Остановлено администратором",
  bot_blocked: "Бот заблокирован пользователем",
  chat_not_found: "Чат не найден",
  notification_deleted: "Уведомление удалено",
  unknown: "Причина не указана",
};

const COUNTERS_GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5";

function formatCount(value: number): string {
  return value.toLocaleString("ru-RU");
}

function skippedReasonLabel(reason: string): string {
  return SKIPPED_REASON_LABELS[reason] ?? `Другая причина (${reason})`;
}

/** Агрегаты outbox: только счётчики, без пользователей и тел сообщений. */
export function TelegramMetricsCard() {
  const { isPending, isError, error, data, refetch } =
    useTelegramMetricsQuery();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Доставка Telegram</CardTitle>
        <CardDescription>
          Счётчики outbox: без идентификаторов пользователей и текстов
          сообщений.
        </CardDescription>
        {data ? (
          <CardAction>
            <Badge variant={data.channelEnabled ? "default" : "secondary"}>
              Канал: {data.channelEnabled ? "вкл" : "выкл"}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <MetricsLoading />
        ) : isError ? (
          <Alert variant="destructive">
            <AlertTitle>Метрики Telegram недоступны</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
            <AlertAction>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void refetch()}
              >
                Повторить
              </Button>
            </AlertAction>
          </Alert>
        ) : (
          <MetricsBody metrics={data} />
        )}
      </CardContent>
    </Card>
  );
}

function MetricsLoading() {
  return (
    <div
      aria-label="Загрузка метрик Telegram"
      className="space-y-4"
      role="status"
    >
      <div className={COUNTERS_GRID}>
        {COUNTERS.map((counter) => (
          <Skeleton key={counter.key} className="h-20 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
    </div>
  );
}

function MetricsBody({ metrics }: { metrics: AdminTelegramMetricsDto }) {
  const skipped = Object.entries(metrics.skipped).sort(
    ([, left], [, right]) => right - left,
  );

  return (
    <div className="space-y-5">
      {!metrics.channelEnabled ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          Канал выключен: новые задачи не отправляются и попадают в пропущенные.
        </p>
      ) : null}

      <dl className={COUNTERS_GRID}>
        {COUNTERS.map((counter) => (
          <div
            key={counter.key}
            className="rounded-lg border border-border bg-muted/40 p-3"
          >
            <dt className="text-xs text-muted-foreground">{counter.label}</dt>
            <dd
              className={
                counter.key === "failed" && metrics.failed > 0
                  ? "mt-1 text-2xl font-semibold text-destructive tabular-nums"
                  : "mt-1 text-2xl font-semibold tabular-nums"
              }
            >
              {formatCount(metrics[counter.key])}
            </dd>
          </div>
        ))}
      </dl>

      {metrics.total === 0 ? (
        <p className="text-sm text-muted-foreground">
          Задач на доставку пока нет — счётчики появятся после первого
          уведомления.
        </p>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Пропущено по причинам</h3>
        {skipped.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Пропусков нет: все задачи доставки в работе или доставлены.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {skipped.map(([reason, count]) => (
              <li
                key={reason}
                className="flex items-center justify-between gap-4 py-2"
              >
                <span className="text-sm">{skippedReasonLabel(reason)}</span>
                <span className="text-sm font-medium tabular-nums">
                  {formatCount(count)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
