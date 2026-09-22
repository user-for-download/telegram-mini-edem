// telegram-app/src/hooks/useOnlineStatus.ts
// Паритет VK OfflineBanner: единый источник онлайн-статуса для TG.
// wasOffline нужен, чтобы кратко показать «Соединение восстановлено».
import { useSyncExternalStore, useState } from "react";

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

  return { isOnline, wasOffline };
}
