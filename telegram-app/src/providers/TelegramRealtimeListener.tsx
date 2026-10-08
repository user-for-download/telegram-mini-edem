import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hapticFeedback } from "@tma.js/sdk-react";
import { Snackbar } from "@telegram-apps/telegram-ui";
import toastStyles from "@/components/Toast/Toast.module.css";
import { buildWsEventKey, markSeenEvent } from "@/api/ws";
import { useWs, useWsEvent } from "@/providers/WebSocketProvider";
import { TRIP_KEYS } from "@/queries/useTripsQuery";
import { BOOKING_KEYS } from "@/queries/useBookingsQuery";
import { NOTIFICATION_KEYS } from "@/queries/useNotificationsQuery";
import { REVIEW_KEYS } from "@/queries/useReviewsQuery";
import { RIDE_REQUEST_KEYS } from "@/queries/useRideRequestsQuery";


interface RealtimeNotice {
  key: string;
  title: string;
  subtitle?: string;
}

/** Максимум одновременных realtime-уведомлений (старые вытесняются). */
const REALTIME_NOTICES_MAX = 3;

function notifyHaptic(kind: "success" | "error"): void {
  try {
    hapticFeedback.notificationOccurred.ifAvailable(kind);
  } catch {
    // Вне Telegram WebView / в тестах — молча пропускаем.
  }
}

/**
 * Слушатель realtime-событий: инвалидация запросов по контракту ws.v1
 * + дедуплицированные уведомления (telegram-ui Snackbar).
 *
 * Эффекты идемпотентны: повторная доставка того же события (reconnect,
 * resync) гасится seen-множеством и dedupeKey уведомлений.
 */
/**
 * Дедуп realtime-событий — на уровне модуля, а не инстанса компонента.
 * Слушатель обязан быть синглтоном (AppConfig монтирует один), но второй
 * маунт возможен (вложенный layout, HMR, будущий рефактор): общее множество
 * гасит повторные haptics/тосты/инвалидации от второго инстанса. Локальный
 * seenRef здесь не годится — у каждого маунта был бы свой.
 * NB для тестов: множество живёт между тестами одного файла — ключи событий
 * в тестах обязаны быть уникальными (см. WebSocketProvider.test.tsx).
 */
let realtimeSeenEvents: ReadonlySet<string> = new Set();

export const TelegramRealtimeListener: FC = () => {
  const queryClient = useQueryClient();
  const { resyncSeq } = useWs();
  const [notices, setNotices] = useState<RealtimeNotice[]>([]);

  const enqueueNotice = useCallback((notice: RealtimeNotice) => {
    setNotices((prev) => {
      if (prev.some((item) => item.key === notice.key)) return prev;
      return [...prev, notice].slice(-REALTIME_NOTICES_MAX);
    });
  }, []);

  const dismissNotice = useCallback((key: string) => {
    setNotices((prev) => prev.filter((item) => item.key !== key));
  }, []);

  const isDuplicate = useCallback((type: string, payload: unknown): boolean => {
    const { seen, duplicate } = markSeenEvent(
      realtimeSeenEvents,
      buildWsEventKey(type, payload),
    );
    realtimeSeenEvents = seen;
    return duplicate;
  }, []);

  // Reconnect после разрыва: за время обрыва данные могли устареть —
  // обновляем всё, что зависит от WS-событий. Дедуп выше гасит повторную
  // доставку тех же событий сервером. Inbox уведомлений — authoritative
  // канал parity: пропущенные за разрыв события иначе не подтянутся
  // до ручного рефетча.
  //
  // Заявки — blanket по RIDE_REQUEST_KEYS.all, а не по tripId: за разрыв
  // могли прийти хинты по нескольким поездкам, а адресата мы бы не узнали
  // (события не дошли). Здесь идёт редкий путь (reconnect), в отличие от
  // живого `ride_request:new`, где адрес известен точно.
  useEffect(() => {
    if (resyncSeq === 0) return;
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.all });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.all });
    void queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
    void queryClient.invalidateQueries({ queryKey: RIDE_REQUEST_KEYS.all });
  }, [resyncSeq, queryClient]);

  useWsEvent("notification:new", () => {
    // Событие — только hint, не запись: счётчик бейджа обязан обновиться
    // сразу, видимый список inbox — тоже. Остальные сегменты/страницы
    // подтянутся по staleTime: blanket-инвалидация NOTIFICATION_KEYS.all
    // здесь не нужна (refetchType active — только смонтированные запросы).
    // Тоста намеренно нет (m8): сигнал — бейдж на табе; доменные события
    // (booking:new и др.) уже показывают свои тосты, дубль был бы шумом.
    void queryClient.invalidateQueries({
      queryKey: NOTIFICATION_KEYS.unreadCount(),
    });
    void queryClient.invalidateQueries({
      queryKey: NOTIFICATION_KEYS.lists(),
      refetchType: "active",
    });
  });

  useWsEvent("booking:new", ({ bookingId, tripId }) => {
    if (isDuplicate("booking:new", { bookingId, tripId })) return;
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.my() });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.trip(tripId) });
    // Новая бронь меняет seatsAvailable — обновляем и публичные списки.
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.lists() });
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.detail(tripId) });
    // Сводка заявок водителя (useDriverRequestsQuery → DriverTripRequests)
    // живёт под своим ключом и в остальные списки не входит. Без этой
    // инвалидации новая заявка не появлялась у водителя до перезагрузки:
    // staleTime 60с + refetchOnWindowFocus:false не давали рефетча.
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.driver() });
    enqueueNotice({
      key: `ws_booking_new_${bookingId}`,
      title: "Новая заявка на место",
    });
  });

  useWsEvent("booking:status_changed", ({ bookingId, tripId, status }) => {
    if (isDuplicate("booking:status_changed", { bookingId, tripId, status })) return;
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.my() });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.history() });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.trip(tripId) });
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.my() });
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.detail(tripId) });
    // Подтверждение/отклонение брони меняет занятость мест в публичных списках.
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.lists() });
    // У водителя из сводки уходит обработанная/отменённая заявка.
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.driver() });

    if (status === "confirmed") {
      notifyHaptic("success");
      enqueueNotice({
        key: `ws_booking_confirmed_${bookingId}`,
        title: "Ваша заявка подтверждена!",
      });
    } else if (status === "declined") {
      notifyHaptic("error");
      enqueueNotice({
        key: `ws_booking_declined_${bookingId}`,
        title: "Ваша заявка отклонена",
      });
    }
  });

  useWsEvent("trip:status_changed", ({ tripId, status }) => {
    if (isDuplicate("trip:status_changed", { tripId, status })) return;
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.my() });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.my() });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.history() });
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.detail(tripId) });
    // Отменённая/завершённая поездка должна исчезнуть из публичного поиска.
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.lists() });
    // Отмена/завершение поездки убирает её заявки из сводки водителя.
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.driver() });

    if (status === "cancelled") {
      notifyHaptic("error");
      enqueueNotice({
        key: `ws_trip_cancelled_${tripId}`,
        title: "Поездка отменена водителем",
      });
    } else if (status === "completed") {
      notifyHaptic("success");
      // Поездка завершена → она стала доступна для отзыва. Список
      // доступных поездок — отдельный ключ; без инвалидации тост
      // «Вы можете оставить отзыв» показывался, а поездки в списке
      // не было (staleTime 60с, фокус не рефетчит).
      void queryClient.invalidateQueries({
        queryKey: REVIEW_KEYS.availableTrips(),
      });
      enqueueNotice({
        key: `ws_trip_completed_${tripId}`,
        title: "Поездка завершена",
        subtitle: "Вы можете оставить отзыв",
      });
    }
  });

  /**
   * Новый попутчик под маршрут этой поездки (`ride_request:new`).
   *
   * Обратная сторона пересечения заявки и поездки: водитель узнаёт о спросе
   * сразу, а не по `staleTime` 30с. Инвалидируем ключ КОНКРЕТНОЙ поездки
   * (`RIDE_REQUEST_KEYS.trip`), а не `all`: у водителя может быть несколько
   * поездок, а спрос под новую заявку появился только под одной.
   *
   * Тост здесь лишний: событие прилетает к водителю, у которого открыта
   * страница поездки или список своих поездок, и карточка спроса нарисуется
   * сама после рефетча. Молчащий 403 на карточке без спроса (сценарий
   * «водитель без заявок») остаётся тихим — тост шарил бы шумом.
   */
  useWsEvent("ride_request:new", ({ tripId }) => {
    void queryClient.invalidateQueries({
      queryKey: RIDE_REQUEST_KEYS.trip(tripId),
    });
  });

  useWsEvent("trip:details_changed", ({ tripId }) => {
    if (isDuplicate("trip:details_changed", { tripId })) return;
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.detail(tripId) });
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.my() });
    // Публичные списки (поиск/главная) тоже могут показывать изменённые
    // маршрут/цену/время — инвалидируем, чтобы не отдавать устаревшее.
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.lists() });
    enqueueNotice({
      key: `ws_trip_changed_${tripId}`,
      title: "Детали поездки изменены",
      subtitle: "Водитель внёс изменения, проверьте информацию",
    });
  });

  return (
    <div aria-live="polite" data-testid="tg-realtime-notices">
      {notices.map(
        (notice): ReactNode => (
          <Snackbar
            key={notice.key}
            className={toastStyles.snackbar}
            description={notice.subtitle}
            duration={4000}
            onClose={() => dismissNotice(notice.key)}
          >
            {notice.title}
          </Snackbar>
        ),
      )}
    </div>
  );
};
