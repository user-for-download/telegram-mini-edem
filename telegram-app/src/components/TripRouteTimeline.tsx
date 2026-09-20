import { Timeline } from "@telegram-apps/telegram-ui";

export interface TripRouteTimelineProps {
  fromCity: string;
  fromAddress?: string | null;
  /** Время отправления; без него — только город (время уже в шапке карточки). */
  fromTime?: string | null;
  toCity: string;
  toAddress?: string | null;
  arrival?: string | null;
}

const ADDRESS_FALLBACK =
  "Точное место встречи станет доступно после подтверждения брони";

/**
 * Маршрут поездки: 2 нативные Timeline.Item (отправление + прибытие).
 * Steps не подходит — только прогресс (count/progress), без header/children.
 */
export function TripRouteTimeline({
  fromCity,
  fromAddress,
  fromTime,
  toCity,
  toAddress,
  arrival,
}: TripRouteTimelineProps) {
  return (
    <Timeline>
      <Timeline.Item
        header={fromTime ? `${fromTime} · ${fromCity}` : fromCity}
        mode="active"
      >
        <span>{fromAddress ?? ADDRESS_FALLBACK}</span>
      </Timeline.Item>
      <Timeline.Item
        header={arrival ? `${arrival} · ${toCity}` : toCity}
        mode="active"
      >
        <span>{toAddress ?? ADDRESS_FALLBACK}</span>
      </Timeline.Item>
    </Timeline>
  );
}
