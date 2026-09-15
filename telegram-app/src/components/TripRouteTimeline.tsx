import { Timeline } from "@telegram-apps/telegram-ui";

export interface TripRouteTimelineProps {
  fromCity: string;
  fromAddress?: string | null;
  fromTime: string;
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
      <Timeline.Item header={`${fromTime} · ${fromCity}`}>
        <span>{fromAddress ?? ADDRESS_FALLBACK}</span>
      </Timeline.Item>
      <Timeline.Item
        header={arrival ? `${arrival} · ${toCity}` : toCity}
        mode="pre-active"
      >
        <span>{toAddress ?? ADDRESS_FALLBACK}</span>
      </Timeline.Item>
    </Timeline>
  );
}
