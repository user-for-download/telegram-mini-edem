import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Snackbar } from "@telegram-apps/telegram-ui";
import { wsServerEventSchema, type WsServerEvent } from "@edem/contracts";
import { apiClient } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { TRIP_KEYS } from "@/queries/useTripsQuery";
import { BOOKING_KEYS } from "@/queries/useBookingsQuery";
import { NOTIFICATION_KEYS } from "@/queries/useNotificationsQuery";
import {
  buildWsEventKey,
  classifyWsClose,
  computeReconnectDelay,
  getWsUrl,
  markSeenEvent,
} from "@/api/ws";

/**
 * Telegram WebSocket client (ws.v1).
 *
 * Реализация контракта `docs/migration/telegram-realtime-contract.md`:
 *
 * - сокет открывается только при `status === "authenticated"` и шлёт JWT
 *   ПЕРВЫМ сообщением `{"type":"auth","token"}` — никогда в URL/query;
 *   сырая Telegram initData по этому каналу не передаётся;
 * - серверный `ping` → клиентский `pong`, клиентского ping/subscription нет;
 * - reconnect — bounded exponential backoff 1s→30s + jitter, один сокет;
 * - 1008/4401 — существующий single-flight HTTP refresh (`apiClient`),
 *   reconnect с новым токеном; перманентный отказ — стоп, сессией
 *   занимается AuthGate;
 * - 4403 (бан/удаление) — терминально: без reconnect и без refresh-loop,
 *   экран account-state; reconnect только после НОВОЙ сессии;
 * - 1000 (normal) — стоп, reconnect только при перезапуске жизненного цикла;
 * - пауза reconnect в background (visibility/offline), resume по
 *   visibility/online;
 * - resync после каждого reconnect — инвалидация запросов (HTTP, не replay).
 */

interface WsContextValue {
  isConnected: boolean;
  lastMessage: WsServerEvent | null;
  /**
   * Счётчик успешных переподключений (auth:ok после предыдущего разрыва).
   * Слушатель делает resync-инвалидацию при его изменении.
   */
  resyncSeq: number;
}

const WsContext = createContext<WsContextValue | null>(null);

export function useWs(): WsContextValue {
  const context = useContext(WsContext);
  if (!context) {
    throw new Error("useWs must be used within WsProvider");
  }
  return context;
}

type PayloadOf<T extends WsServerEvent["type"]> =
  Extract<WsServerEvent, { type: T }> extends { payload: infer P } ? P : undefined;

/**
 * Подписка на одно WS-событие. Handler хранится в ref: инлайн-колбэки
 * создаются при каждом рендере, и зависимость от них приводила бы к
 * повторному срабатыванию на то же lastMessage (дедупликация эффектов).
 */
export function useWsEvent<T extends WsServerEvent["type"]>(
  type: T,
  handler: (payload: PayloadOf<T>) => void,
): void {
  const { lastMessage } = useWs();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (lastMessage?.type === type) {
      const event = lastMessage as Extract<WsServerEvent, { type: T }>;
      if ("payload" in event) {
        handlerRef.current(event.payload as PayloadOf<T>);
      } else {
        handlerRef.current(undefined as PayloadOf<T>);
      }
    }
  }, [lastMessage, type]);
}

export const WsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [lastMessage, setLastMessage] = useState<WsServerEvent | null>(null);
  const [resyncSeq, setResyncSeq] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  // Был ли хотя бы один успешный auth:ok — отличаем первый коннект
  // (resync не нужен, запросы и так свежие) от переподключения.
  const hasAuthedRef = useRef(false);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const disposedRef = useRef(false);
  /**
   * Токен сессии, закрытой терминальным 4403. Пока store хранит тот же
   * (или никакой) токен — reconnect запрещён; новая сессия (другой токен)
   * снимает терминал. Refresh-loop бана запрещён контрактом.
   */
  const terminalTokenRef = useRef<string | null>(null);

  const authenticated = useAuthStore((state) => state.status === "authenticated");
  const accessToken = useAuthStore((state) => state.session?.accessToken ?? null);

  const connectRef = useRef<() => void>(() => {});
  const scheduleReconnectRef = useRef<() => void>(() => {});

  const scheduleReconnect = useCallback(() => {
    if (
      disposedRef.current ||
      reconnectTimeoutRef.current ||
      terminalTokenRef.current ||
      !navigator.onLine ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    const attempt = reconnectAttemptRef.current++;
    const delay = computeReconnectDelay(attempt);

    reconnectTimeoutRef.current = window.setTimeout(() => {
      reconnectTimeoutRef.current = null;
      if (!disposedRef.current) connectRef.current();
    }, delay);
  }, []);

  const connect = useCallback(() => {
    if (disposedRef.current) return;
    if (terminalTokenRef.current) return;
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) return;
    // Если идёт refresh — не пытаемся переподключиться: после завершения
    // нас разбудит onRefreshEnd/onTokenUpdate.
    if (apiClient.isRefreshing()) return;

    const session = useAuthStore.getState();
    if (session.status !== "authenticated") return;
    const token = session.session?.accessToken;
    if (!token) return;

    // Токен — только в auth-сообщении, чтобы не светить его в URL
    // (query-параметры попадают в логи прокси/браузера).
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", token }));
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        // Невалидный JSON игнорируем (контракт: unknown/malformed — мимо).
        return;
      }
      const result = wsServerEventSchema.safeParse(raw);
      if (!result.success) {
        return;
      }
      const parsed = result.data;
      if (parsed.type === "auth:ok") {
        reconnectAttemptRef.current = 0;
        setIsConnected(true);
        // Переподключение после разрыва: данные могли устареть —
        // уведомляем слушателя, чтобы он сделал resync-инвалидацию.
        if (hasAuthedRef.current) {
          setResyncSeq((seq) => seq + 1);
        }
        hasAuthedRef.current = true;
        return;
      }
      // Серверный keep-alive: отвечаем pong, иначе сервер закроет
      // соединение кодом 1001 (Pong timeout).
      if (parsed.type === "ping") {
        try {
          ws.send(JSON.stringify({ type: "pong" }));
        } catch {
          // Сокет умер между чтением и ответом — onclose запланирует reconnect.
        }
        return;
      }
      setLastMessage(parsed);
    };

    ws.onclose = async (e) => {
      if (disposedRef.current || wsRef.current !== ws) return;
      setIsConnected(false);
      wsRef.current = null;

      const policy = classifyWsClose(e.code);

      // 4403: бан/удаление — терминально. Ни reconnect, ни refresh-loop:
      // сессию гасим по HTTP auth-политике (экран бана), banReason из
      // close-причины НЕ берём (причины — только диагностика, не данные
      // авторизации; реальную причину подтянет следующий HTTP bootstrap).
      if (policy === "terminal") {
        terminalTokenRef.current =
          useAuthStore.getState().session?.accessToken ?? null;
        apiClient.invalidatePendingRefresh();
        apiClient.setSession(null);
        useAuthStore.setState({
          status: "banned",
          user: null,
          session: null,
          banReason: null,
          initData: null,
        });
        return;
      }

      // 1000: штатное закрытие — reconnect только при перезапуске
      // жизненного цикла приложения.
      if (policy === "stop") {
        return;
      }

      // 1008/4401: токен протух/невалиден — single-flight refresh.
      if (policy === "auth-refresh") {
        // Refresh уже идёт (например, из-за 401 в HTTP-клиенте) — просто
        // ждём его завершения. Подписка onRefreshEnd переподключит нас.
        if (apiClient.isRefreshing()) {
          return;
        }

        const refreshResult = await apiClient.tryRefresh();

        if (refreshResult === "success") {
          if (!disposedRef.current) connectRef.current();
        } else if (refreshResult === "transient-failure") {
          scheduleReconnectRef.current();
        }
        // permanent-rejection: стоп, сессией занимается AuthGate
        // (onSessionExpired/onBanned уже обновили стор).
        return;
      }

      // Обычный reconnect с backoff при обрыве сети/троттлинге/ошибках.
      scheduleReconnectRef.current();
    };

    ws.onerror = () => {
      // Детали — у браузера; сразу после onerror придёт onclose.
    };
  }, []);

  useEffect(() => {
    const unsubscribeRefreshEnd = apiClient.onRefreshEnd((result) => {
      if (
        result === "permanent-rejection" ||
        disposedRef.current ||
        terminalTokenRef.current ||
        wsRef.current ||
        reconnectTimeoutRef.current
      ) return;

      // Refresh не удался (сеть/5xx) — планируем reconnect с backoff,
      // иначе WS-канал останется мёртвым до следующего online/visibility.
      if (result === "transient-failure") {
        scheduleReconnectRef.current();
        return;
      }

      // ApiClient emits refreshEnd непосредственно перед сбросом
      // refreshPromise — переподключаемся следующим таском, чтобы
      // connect() увидел isRefreshing() === false.
      reconnectTimeoutRef.current = window.setTimeout(() => {
        reconnectTimeoutRef.current = null;
        if (!disposedRef.current) connectRef.current();
      }, 0);
    });

    return unsubscribeRefreshEnd;
  }, []);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

  // Токен обновился (успешный refresh где-то в приложении) — если соединение
  // закрыто и reconnect не запланирован, пробуем переподключиться сразу.
  useEffect(() => {
    const unsubscribeTokenUpdate = apiClient.onTokenUpdate(() => {
      if (!wsRef.current && !reconnectTimeoutRef.current) {
        connectRef.current();
      }
    });

    return () => {
      unsubscribeTokenUpdate();
    };
  }, []);

  // Разбор сокета БЕЗ setState: состояние isConnected ведут сокет-колбэки
  // (onopen/onclose) и render-фаза ниже. setState здесь запрещён
  // react-hooks/set-state-in-effect — disconnect() вызывался из эффектов.
  // NB: onclose перед close() зануляем, поэтому колбэк не выстрелит —
  // сброс isConnected делает render-фаза (сессия потеряна).
  const teardownSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close(1000, "Provider disconnected");
    }
  }, []);

  // Сессия потеряна (logout/бан/протухший токен): живой сокет уже разобран
  // teardown'ом в эффекте, флаг соединения сбрасываем здесь же фазой
  // рендера — иначе UI врёт «подключено» (onclose занулен, колбэк молчит).
  const sessionLost = !authenticated || !accessToken;
  if (sessionLost && isConnected) setIsConnected(false);

  useEffect(() => {
    disposedRef.current = false;
    if (authenticated && accessToken) {
      // Новая сессия после терминального 4403 снимает запрет reconnect.
      if (terminalTokenRef.current && terminalTokenRef.current !== accessToken) {
        terminalTokenRef.current = null;
        reconnectAttemptRef.current = 0;
        hasAuthedRef.current = false;
      }
      connect();
    } else {
      hasAuthedRef.current = false;
      reconnectAttemptRef.current = 0;
      teardownSocket();
    }

    const resume = () => {
      const session = useAuthStore.getState();
      if (
        session.status === "authenticated" &&
        session.session?.accessToken &&
        navigator.onLine &&
        document.visibilityState !== "hidden" &&
        !terminalTokenRef.current
      ) {
        reconnectAttemptRef.current = 0;
        connectRef.current();
      }
    };
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);

    return () => {
      disposedRef.current = true;
      window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
      // Ротация токена (silent refresh) — НЕ повод рвать живой сокет:
      // сервер держит соединение до expiry старого токена, затем придёт
      // 4401 и клиент переподключится уже с новым токеном. Иначе каждый
      // refresh давал бы reconnect-шторм с лишним resync. Рвём только
      // при потере сессии (logout/бан) — connect() сам переиспользует
      // живой сокет при повторном монтировании.
      const session = useAuthStore.getState();
      if (session.status !== "authenticated" || !session.session?.accessToken) {
        teardownSocket();
      }
    };
  }, [authenticated, accessToken, connect, teardownSocket]);

  const value = useMemo(
    () => ({ isConnected, lastMessage, resyncSeq }),
    [isConnected, lastMessage, resyncSeq],
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
};

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
export const TelegramRealtimeListener: FC = () => {
  const queryClient = useQueryClient();
  const { resyncSeq } = useWs();
  const seenRef = useRef<Set<string>>(new Set());
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
      seenRef.current,
      buildWsEventKey(type, payload),
    );
    seenRef.current = seen;
    return duplicate;
  }, []);

  // Reconnect после разрыва: за время обрыва данные могли устареть —
  // обновляем всё, что зависит от WS-событий. Дедуп выше гасит повторную
  // доставку тех же событий сервером.
  useEffect(() => {
    if (resyncSeq === 0) return;
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.all });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.all });
  }, [resyncSeq, queryClient]);

  useWsEvent("notification:new", () => {
    // Событие — только hint, не запись: инвалидируем inbox, UI подтянет
    // авторитетное состояние HTTP-запросом.
    void queryClient.invalidateQueries({ queryKey: NOTIFICATION_KEYS.all });
  });

  useWsEvent("booking:new", ({ bookingId, tripId }) => {
    if (isDuplicate("booking:new", { bookingId, tripId })) return;
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.my() });
    void queryClient.invalidateQueries({ queryKey: BOOKING_KEYS.trip(tripId) });
    // Новая бронь меняет seatsAvailable — обновляем и публичные списки.
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.lists() });
    void queryClient.invalidateQueries({ queryKey: TRIP_KEYS.detail(tripId) });
    enqueueNotice({
      key: `ws_booking_new_${bookingId}`,
      title: "Новая заявка на поездку",
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

    if (status === "cancelled") {
      notifyHaptic("error");
      enqueueNotice({
        key: `ws_trip_cancelled_${tripId}`,
        title: "Поездка отменена водителем",
      });
    } else if (status === "completed") {
      notifyHaptic("success");
      enqueueNotice({
        key: `ws_trip_completed_${tripId}`,
        title: "Поездка завершена",
        subtitle: "Вы можете оставить отзыв",
      });
    }
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
