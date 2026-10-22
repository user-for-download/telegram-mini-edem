import type { AdminDashboardDto } from "@edem/contracts";
import { Link } from "@tanstack/react-router";

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { useDashboardQuery } from "./queries";

const METRICS: Array<{
  key: keyof AdminDashboardDto;
  label: string;
  description: string;
}> = [
  {
    key: "totalUsers",
    label: "Всего пользователей",
    description: "Зарегистрированные аккаунты",
  },
  {
    key: "totalTrips",
    label: "Всего поездок",
    description: "Создано за всё время",
  },
  {
    key: "activeTrips",
    label: "Активные поездки",
    description: "Открыты для бронирования",
  },
  {
    key: "totalBookings",
    label: "Бронирования",
    description: "Всего забронированных мест",
  },
  {
    key: "totalReviews",
    label: "Отзывы",
    description: "Оставлено пользователями",
  },
  {
    key: "newUsersLast7Days",
    label: "Новых за 7 дней",
    description: "Регистрации за последнюю неделю",
  },
];

type ActionQueueKey =
  | "pendingReviews"
  | "openReports"
  | "unansweredFeedback"
  | "telegramPending"
  | "telegramFailed";

const ACTION_QUEUES: ReadonlyArray<{
  key: ActionQueueKey;
  label: string;
  description: string;
  to: string;
  search?: Record<string, string>;
}> = [
  {
    key: "pendingReviews",
    label: "Отзывы на модерации",
    description: "Ожидают решения",
    to: "/reviews",
    search: { status: "pending" },
  },
  {
    key: "openReports",
    label: "Открытые жалобы",
    description: "Новые и в работе",
    to: "/reports",
    search: { status: "pending" },
  },
  {
    key: "unansweredFeedback",
    label: "Обращения без ответа",
    description: "Поддержка ждёт ответа",
    to: "/feedback",
    search: { answered: "false" },
  },
  {
    key: "telegramPending",
    label: "Telegram в очереди",
    description: "Доставки ожидают отправки",
    to: "/settings",
  },
  {
    key: "telegramFailed",
    label: "Ошибки Telegram",
    description: "Неудачные доставки",
    to: "/settings",
  },
];

const GRID_CLASS = "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3";

function ActionQueueCard({
  label,
  description,
  value,
  to,
  search,
}: {
  label: string;
  description: string;
  value: number;
  to: string;
  search?: Record<string, string>;
}) {
  return (
    <Link
      aria-label={`${label}: ${value.toLocaleString("ru-RU")}`}
      className="rounded-xl focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
      search={search}
      to={to}
    >
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-3xl font-semibold">
            {value.toLocaleString("ru-RU")}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function MetricCard({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold">
          {value.toLocaleString("ru-RU")}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { isPending, isError, error, data, refetch } = useDashboardQuery();

  if (isPending) {
    return (
      <div role="status" aria-label="Загрузка дашборда" className={GRID_CLASS}>
        {METRICS.map((metric) => (
          <Skeleton key={metric.key} className="h-32 rounded-xl" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Дашборд недоступен</AlertTitle>
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
    );
  }

  return (
    <div className="grid gap-6">
      <section aria-labelledby="dashboard-actions-title" className="grid gap-3">
        <div>
          <h2 className="text-lg font-semibold" id="dashboard-actions-title">
            Требует внимания
          </h2>
          <p className="text-sm text-muted-foreground">
            Очереди, которые ждут решения администратора
          </p>
        </div>
        <div className={GRID_CLASS}>
          {ACTION_QUEUES.map((queue) => (
            <ActionQueueCard
              description={queue.description}
              key={queue.key}
              label={queue.label}
              search={queue.search}
              to={queue.to}
              value={data[queue.key]}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="dashboard-metrics-title" className="grid gap-3">
        <h2 className="text-lg font-semibold" id="dashboard-metrics-title">
          Общая статистика
        </h2>
        <div className={GRID_CLASS}>
          {METRICS.map((metric) => (
            <MetricCard
              key={metric.key}
              label={metric.label}
              value={data[metric.key]}
              description={metric.description}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
