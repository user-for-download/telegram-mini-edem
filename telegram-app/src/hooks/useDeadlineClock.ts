import { useEffect, useState } from "react";

const MAX_TIMEOUT_MS = 2_147_483_647;

/** Обновляет снимок времени на границе срока и при возвращении в окно. */
export function useDeadlineClock(deadline: string | null): number {
  const timestamp = deadline === null ? NaN : Date.parse(deadline);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = Number.isFinite(timestamp) && timestamp > now
      ? window.setTimeout(refresh, Math.min(Math.max(timestamp - Date.now(), 0), MAX_TIMEOUT_MS))
      : undefined;
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", refresh);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", refresh);
    };
  }, [timestamp, now]);
  return now;
}
