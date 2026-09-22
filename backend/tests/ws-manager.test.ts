import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WSContext } from "hono/ws";
import { wsManager, startWsReaper, stopWsReaper } from "../src/services/wsManager.js";
import { wsConnectionLimitHits } from "../src/metrics.js";
import { app } from "../src/app.js";
import { env } from "../src/env.js";

/**
 * Юнит-тесты WebSocketManager: лимит соединений на пользователя,
 * auth timeout, reaper мёртвых соединений. WS-транспорт не поднимаем —
 * передаём фейковые WSContext-объекты (нужны только send/close).
 */
function makeFakeWs() {
  return {
    send: vi.fn(),
    close: vi.fn(),
  } as unknown as WSContext<WebSocket>;
}

describe("WebSocketManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    stopWsReaper();
    wsManager.closeAll(1000, "test cleanup");
    vi.useRealTimers();
  });

  it("rejects the 6th connection for the same user with 1013", () => {
    for (let i = 0; i < 5; i++) {
      const connId = wsManager.register(makeFakeWs());
      expect(wsManager.authenticate(connId, "user-1")).toBe(true);
    }

    const beforeHits = wsConnectionLimitHits.get();

    // 6-я вкладка/клиент того же пользователя.
    const sixth = wsManager.register(makeFakeWs());
    const accepted = wsManager.authenticate(sixth, "user-1");

    expect(accepted).toBe(false);
    expect(wsConnectionLimitHits.get()).toBe(beforeHits + 1);

    // close(connId, 1013, ...) внутри authenticate убрал соединение:
    // 6-го в статистике нет, 5 «живых» остались.
    expect(wsManager.getStats().totalConnections).toBe(5);
    expect(wsManager.getStats().authenticatedUsers).toBe(1);

    // Закрытие 6-го соединения не тронуло 5 «живых» — событие доставляется
    // во все 5 соединений пользователя.
    const sent = wsManager.sendToUser("user-1", {
      type: "notification:new",
      payload: { id: "refresh" },
    });
    expect(sent).toBe(5);
  });

  it("re-authentication by the same user is idempotent and does not hit the limit", () => {
    const connId = wsManager.register(makeFakeWs());

    expect(wsManager.authenticate(connId, "user-2")).toBe(true);
    expect(wsManager.authenticate(connId, "user-2")).toBe(true);

    expect(wsManager.getStats().totalConnections).toBe(1);
    expect(wsManager.getStats().authenticatedUsers).toBe(1);
  });

  it("closes an authenticated connection when its access token expires", () => {
    const ws = makeFakeWs();
    const connId = wsManager.register(ws);

    expect(wsManager.authenticate(connId, "user-expiring", Date.now() + 10_000)).toBe(true);
    vi.advanceTimersByTime(10_000);

    expect(ws.close).toHaveBeenCalledWith(4401, "Access token expired");
    expect(wsManager.getStats().totalConnections).toBe(0);
  });

  it("rejects authentication with an already-expired access token (4401, immediately)", () => {
    // Arrange — expiresAt в прошлом на момент authenticate
    const ws = makeFakeWs();
    const connId = wsManager.register(ws);

    // Act
    const accepted = wsManager.authenticate(connId, "user-expired-past", Date.now() - 1_000);

    // Assert — соединение закрыто НЕМЕДЛЕННО (не по zero-delay таймеру),
    // в статистике не осталось.
    expect(accepted).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(4401, "Access token expired");
    expect(wsManager.getStats().totalConnections).toBe(0);
  });

  it("drops an established connection on re-auth with an expired token", () => {
    // Arrange — соединение уже аутентифицировано со свежим токеном
    const ws = makeFakeWs();
    const connId = wsManager.register(ws);
    expect(wsManager.authenticate(connId, "user-reauth", Date.now() + 60_000)).toBe(true);

    // Act — повторная auth тем же пользователем с ИСТЁКШИМ токеном
    const accepted = wsManager.authenticate(connId, "user-reauth", Date.now() - 1_000);

    // Assert — established-соединение не переживает истёкший токен
    expect(accepted).toBe(false);
    expect(ws.close).toHaveBeenCalledWith(4401, "Access token expired");
    expect(wsManager.getStats().totalConnections).toBe(0);
  });

  it("closes an unauthenticated connection after the auth timeout (4401)", () => {
    const ws = makeFakeWs();
    wsManager.register(ws);

    vi.advanceTimersByTime(5_000);

    expect(ws.close).toHaveBeenCalledWith(4401, "Authentication timeout");
    expect(wsManager.getStats().totalConnections).toBe(0);
  });

  it("reaper closes connections with no pong in time (1001)", () => {
    const ws = makeFakeWs();
    const connId = wsManager.register(ws);
    expect(wsManager.authenticate(connId, "user-3")).toBe(true);

    startWsReaper();
    // Ping уходит на 30s/60s/90s, pong не приходит → после 60s соединение
    // считается мёртвым; первый reaper, который увидит просрочку, — на 90s.
    vi.advanceTimersByTime(91_000);

    expect(ws.close).toHaveBeenCalledWith(1001, "Pong timeout");
    expect(wsManager.getStats().totalConnections).toBe(0);
  });

  it("startWsReaper/stopWsReaper are idempotent", () => {
    expect(() => {
      startWsReaper();
      startWsReaper();
      stopWsReaper();
      stopWsReaper();
    }).not.toThrow();
  });
});

describe("GET /metrics", () => {
  const originalMetricsToken = env.METRICS_TOKEN;
  const originalIsProduction = env.isProduction;

  afterEach(() => {
    env.METRICS_TOKEN = originalMetricsToken;
    env.isProduction = originalIsProduction;
  });

  it("exposes Prometheus-format metrics", async () => {
    env.METRICS_TOKEN = "";
    env.isProduction = false;

    const res = await app.request("/metrics");
    expect(res.status).toBe(200);

    const body = await res.text();
    expect(body).toContain("# TYPE ws_connection_limit_hits_total counter");
    expect(body).toContain("# TYPE ws_connections gauge");
    expect(body).toContain("# TYPE http_requests_total counter");
    expect(body).toContain("ws_connection_limit_hits_total ");
  });

  it("requires the configured bearer token", async () => {
    env.METRICS_TOKEN = "metrics-test-token";

    const missing = await app.request("/metrics");
    const incorrect = await app.request("/metrics", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    const authorized = await app.request("/metrics", {
      headers: { Authorization: "Bearer metrics-test-token" },
    });

    expect(missing.status).toBe(403);
    expect(incorrect.status).toBe(403);
    expect(authorized.status).toBe(200);
  });

  it("hides metrics in production when no token is configured", async () => {
    env.METRICS_TOKEN = "";
    env.isProduction = true;

    const res = await app.request("/metrics");

    expect(res.status).toBe(404);
  });

  it("adds a production-ready CSP for Telegram-only framing", async () => {
    const res = await app.request("/health/live");
    const csp = res.headers.get("Content-Security-Policy");

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).toContain("img-src 'self' data: blob: https:");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("vk.com");
    expect(csp).toContain("object-src 'none'");
  });
});
