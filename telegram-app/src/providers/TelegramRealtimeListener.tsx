import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hapticFeedback } from "@tma.js/sdk-react";
import { Snackbar } from "@telegram-apps/telegram-ui";
import toastStyles from "@/components/Toast/Toast.module.css";
import { buildWsEventKey, markSeenEvent } from "@/api/ws";
import { useWs, useWsEvent } from "@/providers/WebSocketProvider";
import {
  BOOKING_KEYS,
  REVIEW_KEYS,
  RIDE_REQUEST_KEYS,
  TRIP_KEYS,
} from "@/queries/keys";
import { NOTIFICATION_KEYS } from "@/queries/useNotificationsQuery";


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

  /**
   * Забирает событие из seen-множества: `null` = дубль доставки (эффект
   * пропускаем), иначе возвращается ключ, по которому событие засчитано.
   *
   * Ключ отдаём подписчикам, а не только флаг: у `repeatable`-событий
   * (см. WS_EVENT_DEDUP_POLICY в api/ws.ts) в ключ входит временное окно,
   * поэтому он же годится основанием для ключа нотиса — каждая правка
   * поездки получает свой тост, а не один на весь сеанс.
   */
  const claimEvent = useCallback(
    (type: string, payload: unknown): string | null => {
      const key = buildWsEventKey(type, payload);
      const { seen, duplicate } = markSeenEvent(realtimeSeenEvents, key);
      realtimeSeenEvents = seen;
      return duplicate ? null : key;
    },
    [],
  );

  // Reconnect после разрыва: за время обрыва данные могли устареть —
  // обновляем всё, что зависит от WS-событий. Дедуп выше гасит повторную
  // доставку тех же событий сервером. Inbox уведомлений — authoritative
  // канал parity: пропущенные за разрыв события иначе не подтянутся
  // до ручного рефетча.
  //
  // Заявки — blanket по RIDE_REQUEST_KEYS.all: своих заявок (список «Мои
  // заявки») и ленты спроса на главной.
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
    if (claimEvent("booking:new", { bookingId, tripId }) === null) return;
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
    if (claimEvent("booking:status_changed", { bookingId, tripId, status }) === null)
      return;
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
    if (claimEvent("trip:status_changed", { tripId, status }) === null) return;
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

  useWsEvent("trip:details_changed", ({ tripId }) => {
    // Правка деталей поездки (PATCH /trips/:id) приходит с одинаковым
    // payload {tripId} при ЛЮБОЙ правке — по ключу type+payload вторая
    // правка в сессии не отличалась от первой и молча проглатывалась.
    // Тип помечен repeatable (WS_EVENT_DEDUP_POLICY), поэтому ключ несёт
    // временное окно: N правок дают N инвалидаций и N тостов.
    const eventKey = claimEvent("trip:details_changed", { tripId });
    if (eventKey === null) return;
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.detail(tripId) });
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.my() });
    // Публичные списки (поиск/главная) тоже могут показывать изменённые
    // маршрут/цену/время — инвалидируем, чтобы не отдавать устаревшее.
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.lists() });
    enqueueNotice({
      // Ключ нотиса = ключ дедупликации: у этого типа он различает правки
      // окном, поэтому вторая правка не молчит, как это было с
      // строгим `ws_trip_changed_${tripId}`.
      key: eventKey,
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
