import type { AdminSettingsDto } from "@edem/contracts";

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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { TelegramMetricsCard } from "./TelegramMetricsCard";
import { useSettingsQuery } from "./queries";

type RateLimitKey =
  | "createTripRateMax"
  | "cancelTripRateMax"
  | "createBookingRateMax"
  | "cancelBookingRateMax"
  | "publicReadRateMax"
  | "mutationRateMax";

type FlagKey = "allowDevAuth" | "isProduction" | "trustProxy";

const RATE_LIMIT_ROWS: ReadonlyArray<{ key: RateLimitKey; label: string }> = [
  { key: "createTripRateMax", label: "Создание поездок (в сутки)" },
  { key: "cancelTripRateMax", label: "Отмена поездок (в сутки)" },
  { key: "createBookingRateMax", label: "Создание броней (в сутки)" },
  { key: "cancelBookingRateMax", label: "Отмена броней (в сутки)" },
  { key: "publicReadRateMax", label: "Публичные GET (в мин)" },
  { key: "mutationRateMax", label: "Мутации (в мин)" },
];

const FLAG_ROWS: ReadonlyArray<{ key: FlagKey; label: string }> = [
  { key: "allowDevAuth", label: "Dev-авторизация" },
  { key: "isProduction", label: "Production" },
  { key: "trustProxy", label: "Доверенный прокси" },
];

/**
 * Read-only страница настроек: лимиты и флаги из env.
 * Метрики Telegram живут отдельной карточкой со своим loading/error,
 * поэтому сбой /settings не скрывает наблюдаемость доставки.
 */
export function SettingsPage() {
  const { isPending, isError, error, data, refetch } = useSettingsQuery();

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Настройки</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Только для чтения: значения управляются переменными окружения сервера.
        </p>
      </header>
      <TelegramMetricsCard />
      {isPending ? (
        <SettingsLoading />
      ) : isError ? (
        <SettingsError message={error.message} onRetry={() => void refetch()} />
      ) : (
        <>
          <RateLimitsCard settings={data} />
          <FlagsCard settings={data} />
        </>
      )}
    </section>
  );
}

function SettingsLoading() {
  return (
    <div aria-label="Загрузка настроек" className="space-y-6" role="status">
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}

function SettingsError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Настройки недоступны</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertAction>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Повторить
        </Button>
      </AlertAction>
    </Alert>
  );
}

function RateLimitsCard({ settings }: { settings: AdminSettingsDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Лимиты запросов</CardTitle>
        <CardDescription>
          Rate-limit'ы, заданные переменными окружения
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Лимит</TableHead>
              <TableHead>Значение</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {RATE_LIMIT_ROWS.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  <Label>{row.label}</Label>
                </TableCell>
                <TableCell className="tabular-nums">
                  {settings[row.key]}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function FlagsCard({ settings }: { settings: AdminSettingsDto }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Флаги</CardTitle>
        <CardDescription>Режимы работы сервера</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {FLAG_ROWS.map((row) => (
            <li
              key={row.key}
              className="flex items-center justify-between gap-4 py-2.5"
            >
              <Label>{row.label}</Label>
              <FlagBadge value={settings[row.key]} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function FlagBadge({ value }: { value: boolean }) {
  return (
    <Badge variant={value ? "default" : "secondary"}>
      {value ? "вкл" : "выкл"}
    </Badge>
  );
}
