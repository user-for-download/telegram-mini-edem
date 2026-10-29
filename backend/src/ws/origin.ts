/**
 * Чистая проверка Origin для WS-upgrade (CSWSH), без чтения env и сокета.
 * Вынесена из `ws/index.ts`, чтобы юнит-тесты не тянули env/db/Prisma.
 *
 * `forwardedHost` сюда попадает уже после проверки доверия прокси
 * (loopback-пир или TRUST_PROXY) — см. `isWsOriginAllowed`.
 */
export function isWsOriginPermitted(params: {
  origin: string;
  host?: string;
  forwardedHost?: string;
  corsOrigins: string;
}): boolean {
  try {
    const parsed = new URL(params.origin);
    const originHost = parsed.host.toLowerCase();

    const host = params.host?.trim().toLowerCase();
    if (host && originHost === host) return true;

    const forwardedHost = params.forwardedHost?.trim().toLowerCase();
    if (forwardedHost && originHost === forwardedHost) {
      return true;
    }

    return params.corsOrigins
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .includes(parsed.origin.toLowerCase());
  } catch {
    return false;
  }
}
