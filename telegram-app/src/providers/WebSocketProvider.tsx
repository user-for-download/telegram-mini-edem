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
} from "react";
import { wsServerEventSchema, type WsServerEvent } from "@edem/contracts";
import { WS_TERMINAL_REASON, apiClient } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import {
  classifyWsClose,
  computeReconnectDelay,
  getWsUrl,
} from "@/api/ws";

/**
 * Telegram WebSocket client (ws.v1).
 *
 * Исторический контракт ws.v1 удалён из дерева — смотри git
 * (`docs/migration/telegram-realtime-contract.md`):
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

/**
 * Классификация терминального close 4403 по строке причины.
 *
 * Различаем «удалён» и «забанен», потому что это РАЗНЫЕ терминальные
 * экраны: бан — плашка с формой обжалования, удаление — «Профиль удалён»
 * без надежды на восстановление. Раньше оба случая сводились к
 * status="banned", и удалённый аккаунт получал бан-экран.
 *
 * Строка причины — наш собственный фиксированный литерал (не PII и не
 * данные авторизации), но в banReason она НЕ попадает: причина остаётся
 * только из тела HTTP 403 (readBanReason). Принципиал прежний — «причины
 * это диагностика, авторизация по телу ответа»; здесь reason решает
 * лишь, КАКОЙ терминальный переход сделать.
 *
 * Таблица (три источника — три написания, сравнение с одной строкой
 * молча ловило бы только WS-auth путь). Строки живут в `WS_TERMINAL_REASON`
 * (@/api/client) и проверяются тестом против исходников бэка, поэтому
 * переименование на сервере роняет тест, а не тихо уводит экран в «бан»:
 * - WS_TERMINAL_REASON.deletedByWsAuth — ws/index.ts:130 (WS-auth, deletedAt);
 * - WS_TERMINAL_REASON.deletedBySelf   — users/index.ts:278 (DELETE /me,
 *                         самоудаление; без "is" — самый частый случай);
 * - WS_TERMINAL_REASON.banned          — ws/index.ts:136 (WS-auth, bannedAt)
 *                         и admin/index.ts:646 (бан админом).
 *
 * "unknown" — причина пуста или незнакомая (старый клиент, иной бэкенд):
 * безопасный дефолт "banned" + один HTTP-bootstrap, чтобы авторитетный
 * 403 сам уточнил, deleted это или ban.
 */
export type TerminalCloseReason = "deleted" | "banned" | "unknown";

export function classifyTerminalCloseReason(
  reason: string | undefined,
): TerminalCloseReason {
  if (
    reason === WS_TERMINAL_REASON.deletedByWsAuth ||
    reason === WS_TERMINAL_REASON.deletedBySelf
  ) {
    return "deleted";
  }
  if (reason === WS_TERMINAL_REASON.banned) {
    return "banned";
  }
  return "unknown";
}

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
  const status = useAuthStore((state) => state.status);
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
    // NB: переподключение после успешного refresh триггерится из трёх мест
    // (onTokenUpdate, auth-refresh ветка onclose, onRefreshEnd) — это
    // намеренная идемпотентная конвергенция: guard ниже делает повторные
    // вызовы no-op. Не убирать guard без сведения триггеров к одному.
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

      // 4403: бан/удаление — терминально. Ни reconnect, ни refresh-loop.
      // banReason из close-причины НЕ берём (причины — только диагностика,
      // не данные авторизации; реальная причина подтянется из тела 403).
      // Различаем удаление и бан по машинной строке причины: экран у них
      // разный (см. classifyTerminalCloseReason).
      if (policy === "terminal") {
        const terminalReason = classifyTerminalCloseReason(e.reason);
        terminalTokenRef.current =
          useAuthStore.getState().session?.accessToken ?? null;
        apiClient.invalidatePendingRefresh();
        apiClient.setSession(null);

        // Канонический переход удаления — тот же, что у HTTP-пути
        // (403 "Account is deleted"): экран «Профиль удалён», пурж кэша
        // launch params, гашение in-flight refresh.
        if (terminalReason === "deleted") {
          useAuthStore.getState().markAccountDeleted();
          return;
        }

        // Переход в бан — через стор, а не setState: markBanned кладёт в
        // состояние initData для формы обжалования (она шлёт appeal без
        // токена, и без initData запрос не уходил бы вовсе).
        useAuthStore.getState().markBanned(null);

        // Причина незнакома: единственный авторитетный источник — тело
        // 403. Ровно один bootstrap; раньше этот шаг был описан
        // комментарием, но не выполнялся.
        //
        // bootstrap() на время полёта ставит status="initializing"
        // (AuthGate показывает спиннер), а при недоступной сети уводит в
        // "unauthenticated" — и тогда бан-экран с формой обжалования
        // потерялся бы. Поэтому авторитетный ответ (banned/deleted)
        // принимаем как есть, а любой другой исход возвращаем к
        // безопасному дефолту "banned".
        if (terminalReason === "unknown") {
          void useAuthStore.getState().bootstrap().then(() => {
            const next = useAuthStore.getState().status;
            if (next === "banned" || next === "deleted") return;
            useAuthStore.getState().markBanned(null);
          });
        }
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
      // Намеренно тихо: деталей у браузера нет (только сам факт ошибки),
      // сразу следом придёт onclose с кодом — причину восстанавливаем по
      // нему. Во фронте нет sink'а для логов (Sentry не заведён, console.*
      // в src не используем по конвенции), breadcrumb слать некуда.
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
      // Дополнительно: бан могли снять без ротации JWT (админ-действие) —
      // тогда токен тот же, но status уже не "banned": терминал тоже снят.
      if (
        terminalTokenRef.current &&
        (terminalTokenRef.current !== accessToken || status !== "banned")
      ) {
        terminalTokenRef.current = null;
        reconnectAttemptRef.current = 0;
        hasAuthedRef.current = false;
      }
      connect();
    } else {
      // Ветка «не authenticated» — это ДВА разных случая, и различать их
      // обязательно: сокет закрываем в обоих, а флаг «мы уже подключались»
      // сбрасываем только при реальной потере сессии.
      //
      // status="background" (сокет рвётся на уходе в фон, сессия ЖИВА) —
      // это reconnect при возврате, и по контракту он обязан поднять
      // resyncSeq, чтобы слушатель перезабрал данные за время разрыва.
      // Раньше флаг сбрасывался на любом не-authenticated статусе, поэтому
      // после background→foreground auth:ok уходил в ветку «первый коннект»
      // и ресинк не срабатывал — пропущенные события не восстанавливались.
      if (!useAuthStore.getState().session) {
        hasAuthedRef.current = false;
      }
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
        // Гасим pending backoff-таймер перед немедленным connect — иначе
        // старый таймер выстрелит вторым connect (guard спасёт, но
        // дисциплина файла: таймер всегда чистят перед connect).
        if (reconnectTimeoutRef.current) {
          window.clearTimeout(reconnectTimeoutRef.current);
          reconnectTimeoutRef.current = null;
        }
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
  }, [authenticated, accessToken, status, connect, teardownSocket]);

  const value = useMemo(
    () => ({ isConnected, lastMessage, resyncSeq }),
    [isConnected, lastMessage, resyncSeq],
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
};
