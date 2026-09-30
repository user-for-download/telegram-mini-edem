// backend/tests/unit/clientErrorReporter.test.ts
//
// Сервис client-errors: санитайзинг секретов, стабильность отпечатка,
// троттлинг повторов, глобальный потолок + сводка, тишина без chatId.
// Часы и транспорт — через опции (без сети), логгер замокан.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const {
  createClientErrorReporter,
  sanitizeClientErrorText,
  fingerprintClientError,
  buildClientErrorAlertText,
} = await import("../../src/services/clientErrorReporter.js");

const JWT =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

function makeHarness() {
  let t = 1_000_000;
  const sent: Array<{ chatId: number; text: string }> = [];
  const reporter = createClientErrorReporter({
    chatId: -100123,
    now: () => t,
    send: async (input) => {
      sent.push(input);
      return { ok: true };
    },
  });
  return { reporter, sent, advance: (ms: number) => (t += ms) };
}

const base = {
  kind: "error" as const,
  message: "Cannot read properties of undefined",
  stack: "TypeError: boom\n    at App (app.js:10:5)",
  route: "/search",
  release: "1.2.3",
};

describe("sanitizeClientErrorText", () => {
  it("вырезает JWT, tgWebAppData, hash и query-строки", () => {
    const dirty = `fail ${JWT} tgWebAppData=user%3D1%26hash=abc hash=deadbeef https://x/y?a=1&b=2`;
    const clean = sanitizeClientErrorText(dirty);
    expect(clean).not.toContain("eyJ");
    expect(clean).not.toContain("deadbeef");
    expect(clean).not.toContain("a=1");
    expect(clean).toContain("[jwt]");
    expect(clean).toContain("tgWebAppData=[redacted]");
    expect(clean).toContain("hash=[redacted]");
  });

  it("вырезает длинные hex-строки, но оставляет обычные слова", () => {
    expect(sanitizeClientErrorText(`token ${"a".repeat(40)} end`)).toContain(
      "[hex]",
    );
    expect(sanitizeClientErrorText("hello world")).toBe("hello world");
  });
});

describe("fingerprintClientError", () => {
  it("стабилен при смене номеров строк и колонок", () => {
    const a = fingerprintClientError("error", "boom", "at App (app.js:10:5)");
    const b = fingerprintClientError("error", "boom", "at App (app.js:99:12)");
    expect(a).toBe(b);
  });

  it("различает разные сообщения и kind", () => {
    const a = fingerprintClientError("error", "boom");
    expect(fingerprintClientError("error", "other")).not.toBe(a);
    expect(fingerprintClientError("boundary", "boom")).not.toBe(a);
  });
});

describe("createClientErrorReporter", () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    harness = makeHarness();
  });

  it("первое появление уходит сразу, повтор в окне — нет", async () => {
    harness.reporter.report(base);
    harness.reporter.report(base);
    harness.reporter.report(base);
    await Promise.resolve();
    expect(harness.sent).toHaveLength(1);
    expect(harness.sent[0].chatId).toBe(-100123);
    expect(harness.sent[0].text).toContain("Cannot read properties");
  });

  it("повтор после TTL уходит с пометкой ×N", async () => {
    harness.reporter.report(base);
    harness.reporter.report(base);
    harness.reporter.report(base);
    harness.advance(31 * 60 * 1000);
    harness.reporter.report(base);
    await Promise.resolve();
    expect(harness.sent).toHaveLength(2);
    expect(harness.sent[1].text).toContain("×2");
  });

  it("разные ошибки — разные алерты", async () => {
    harness.reporter.report(base);
    harness.reporter.report({ ...base, message: "другая ошибка" });
    await Promise.resolve();
    expect(harness.sent).toHaveLength(2);
  });

  it("глобальный потолок: сверх лимита — тишина, через час — сводка", async () => {
    for (let i = 0; i < 25; i++) {
      harness.reporter.report({ ...base, message: `ошибка ${i}` });
    }
    await Promise.resolve();
    expect(harness.sent).toHaveLength(20);
    harness.advance(61 * 60 * 1000);
    harness.reporter.report({ ...base, message: "триггер сводки" });
    await Promise.resolve();
    const summary = harness.sent.find((m) => m.text.includes("пропущено"));
    expect(summary?.text).toContain("5");
  });

  it("без chatId — только лог, без отправки", async () => {
    const t = 0;
    const sent: unknown[] = [];
    const silent = createClientErrorReporter({
      now: () => t,      send: async (input) => {
        sent.push(input);
        return { ok: true };
      },
    });
    silent.report(base);
    await Promise.resolve();
    expect(sent).toHaveLength(0);
  });

  it("сбой отправки не бросает", () => {
    const failing = createClientErrorReporter({
      chatId: 1,
      now: () => 0,
      send: async () => {
        throw new Error("net down");
      },
    });
    expect(() => failing.report(base)).not.toThrow();
  });
});

describe("buildClientErrorAlertText", () => {
  it("обрезает до ~1000 символов", () => {
    const text = buildClientErrorAlertText(
      { kind: "error", message: "x".repeat(2000) },
      0,
    );
    expect(text.length).toBeLessThanOrEqual(1000);
  });

  it("включает route и release", () => {
    const text = buildClientErrorAlertText(base, 0);
    expect(text).toContain("/search");
    expect(text).toContain("1.2.3");
  });
});
