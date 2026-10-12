import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "@/api/client";

/**
 * Регресс M5: 429 от /auth/refresh был обычным «transient-failure».
 *
 * Дальше WebSocketProvider на него делал `scheduleReconnect()` — то есть
 * немедленный reconnect с ТЕМ ЖЕ протухшим токеном. Сервер отвечал 4401,
 * клиент снова звал refresh и снова получал 429. Цикл «connect → 4401 →
 * refresh → 429» жёг лимит (REFRESH_RATE_MAX = 10 / 10 мин), который и нужен
 * был для восстановления, и приложение оставалось мёртвым до конца окна.
 *
 * Разделение на `rate-limited` + проброс `retryAfterMs` (бэкенд его шлёт)
 * позволяет ждать ровно столько, сколько попросили, вместо мгновенного
 * повтора.
 */
describe("refresh: 429 не равен транзиентному сбою", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const runRefresh = async (status: number, body: unknown) => {
    const client = new ApiClient();
    client.setSession({ accessToken: "access", refreshToken: "refresh" });
    const expired: string[] = [];
    client.onSessionExpired(() => expired.push("expired"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    return { result: await client.tryRefresh(), expired };
  };

  it("429 → kind rate-limited, а не transient-failure", async () => {
    const { result } = await runRefresh(429, {
      code: "RATE_LIMITED",
      message: "Too many requests",
    });
    expect(result.kind).toBe("rate-limited");
  });

  it("пробрасывает retryAfterMs из тела ответа", async () => {
    // Бэкенд шлёт retryAfterMs (rateLimit.ts) — ждать надо ровно его.
    const { result } = await runRefresh(429, {
      code: "RATE_LIMITED",
      retryAfterMs: 42_000,
    });
    expect(result).toEqual({ kind: "rate-limited", retryAfterMs: 42_000 });
  });

  it("без retryAfterMs ждём минимальный вежливый интервал, не 0", async () => {
    // Нулевая пауза — это тот же hot loop, ради которого ветка и выделена.
    const { result } = await runRefresh(429, { code: "RATE_LIMITED" });
    expect(result.kind).toBe("rate-limited");
    if (result.kind === "rate-limited") {
      expect(result.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("429 не трогает сессию: session-expired не эмитится", async () => {
    // Сброс сессии на 429 превратил бы ограничение в logout.
    const { result, expired } = await runRefresh(429, {
      code: "RATE_LIMITED",
    });
    expect(expired).toEqual([]);
    expect(result.kind).not.toBe("permanent-rejection");
  });

  it("остальные статусы по-прежнему транзиентный сбой", async () => {
    for (const status of [500, 502, 418]) {
      const { result } = await runRefresh(status, { message: "boom" });
      expect(result.kind).toBe("transient-failure");
    }
  });

  it("401 остаётся permanent-rejection", async () => {
    const { result } = await runRefresh(401, { message: "revoked" });
    expect(result.kind).toBe("permanent-rejection");
  });
});
