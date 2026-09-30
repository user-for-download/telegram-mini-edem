// backend/tests/integration/client-errors.test.ts
//
// POST /api/v1/client-errors: валидное тело (sendBeacon text/plain) → 204
// без авторизации; невалид → 400; больше 16 KB → 413; превышение лимита →
// 429. Роутер монтируется на чистый Hono (без БД); лимит занижен через ENV.
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.CLIENT_ERRORS_RATE_MAX = "3";
});

vi.mock("../../src/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { clientErrorsRouter } = await import("../../src/client-errors/index.js");

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/v1/client-errors", clientErrorsRouter);
  return app;
}

const app = buildApp();
const URL = "/api/v1/client-errors";

const validBody = JSON.stringify({
  kind: "error",
  message: "boom",
  route: "/search",
});

describe("POST /api/v1/client-errors", () => {
  it("валидное тело в text/plain → 204 без авторизации", async () => {
    const res = await app.request(URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: validBody,
    });
    expect(res.status).toBe(204);
  });

  it("невалидное тело → 400 без стектрейсов", async () => {
    const res = await app.request(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "nope" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(body)).not.toContain("at ");
  });

  it("тело больше 16 KB → 413", async () => {
    const res = await app.request(URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ kind: "error", message: "x".repeat(20 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  it("превышение лимита → 429", async () => {
    // Бюджет файла: 3 запроса (2 сверху + 1 здесь), следующий — за лимитом.
    const ok = await app.request(URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: validBody,
    });
    expect(ok.status).toBe(204);
    const limited = await app.request(URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: validBody,
    });
    expect(limited.status).toBe(429);
  });
});
