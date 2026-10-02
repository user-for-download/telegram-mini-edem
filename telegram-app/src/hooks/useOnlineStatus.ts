// telegram-app/src/hooks/useOnlineStatus.ts
// Единый источник онлайн-статуса для TG.
// wasOffline нужен, чтобы кратко показать «Соединение восстановлено».
import { useEffect, useSyncExternalStore, useState } from "react";

// Порядок тот же, что у TOAST_DURATION_MS (ToastProvider): «соединение
// восстановлено» — transient-подтверждение. Без таймера флаг wasOffline
// жил до следующего ухода в offline, и баннер «Соединение восстановлено»
// висел на каждой странице постоянно.
const RECOVERED_NOTICE_MS = 3200;

function subscribe(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getSnapshot(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

export function useOnlineStatus(): { isOnline: boolean; wasOffline: boolean } {
  const isOnline = useSyncExternalStore(subscribe, getSnapshot, () => true);
  const [wasOffline, setWasOffline] = useState(false);
  const [prevOnline, setPrevOnline] = useState(isOnline);

  // Переход offline→online взводит «соединение восстановлено», уход
  // в offline — сбрасывает. Render-фаза вместо эффекта: setState
  // в эффекте запрещён react-hooks/set-state-in-effect, а переход
  // всегда проходит через offline, отдельный ref-флаг не нужен.
  if (isOnline !== prevOnline) {
    setPrevOnline(isOnline);
    if (!isOnline) setWasOffline(false);
    else if (prevOnline === false) setWasOffline(true);
  }

  // Гасим подтверждение восстановления по таймеру. setTimeout, а не
  // рендер-фаза: здесь нужен отложенный сброс, и цепочка ровно та же, что
  // в отсчёте 429 (AuthGate) — лишние таймеры чистятся на размонтировании.
  useEffect(() => {
    if (!isOnline || !wasOffline) return;
    const timer = setTimeout(() => setWasOffline(false), RECOVERED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [isOnline, wasOffline]);

  return { isOnline, wasOffline };
}
