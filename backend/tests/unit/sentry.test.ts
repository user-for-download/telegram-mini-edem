// backend/tests/unit/sentry.test.ts
// Юнит-тесты хелперов Sentry (backend/src/utils/sentry.ts):
// initSentry (DSN-гейт + beforeSend с очисткой PII), captureWarning, captureException.
// @sentry/node, env и logger замоканы — сетевых вызовов и реальной инициализации нет.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Типы Sentry — только для аннотаций; рантайм-утверждения идут через sentryMocks.
import * as Sentry from "@sentry/node";
import {
  initSentry,
  captureWarning,
  captureException,
} from "../../src/utils/sentry.js";
import { logger } from "../../src/logger.js";

// Частичная фабрика @sentry/node: подменяем только init/captureMessage/captureException,
// остальные экспорты (и типы) берём из оригинала, чтобы импорт оставался валидным.
const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureMessage: vi.fn(() => "event-id"),
  captureException: vi.fn(() => "event-id"),
}));

vi.mock("@sentry/node", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sentry/node")>();
  return {
    ...actual,
    init: sentryMocks.init,
    captureMessage: sentryMocks.captureMessage,
    captureException: sentryMocks.captureException,
  };
});

// Мокаем env: utils/sentry.ts читает env.SENTRY_DSN в момент вызова,
// поэтому мутируем envMocks.SENTRY_DSN внутри каждого теста.
const envMocks = vi.hoisted(() => ({
  SENTRY_DSN: "",
  NODE_ENV: "test",
  isProduction: false,
  ALLOW_DEV_AUTH: false,
  PORT: 3000,
  DATABASE_URL: "",
  JWT_SECRET: "",
  CORS_ORIGINS: "",
  JWT_ACCESS_TTL_SECONDS: 900,
  JWT_REFRESH_TTL_SECONDS: 2592000,
  REFRESH_RATE_WINDOW_MS: 600000,
  REFRESH_RATE_MAX: 10,
}));

vi.mock("../../src/env.js", () => ({ env: envMocks }));

vi.mock("../../src/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const TEST_DSN = "https://fake-dsn@sentry.example/123";
const originalAppVersion = process.env.APP_VERSION;

describe("utils/sentry", () => {
  beforeEach(() => {
    sentryMocks.init.mockClear();
    sentryMocks.captureMessage.mockClear();
    sentryMocks.captureException.mockClear();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.warn).mockClear();
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.debug).mockClear();
  });

  afterEach(() => {
    envMocks.SENTRY_DSN = "";
    if (originalAppVersion === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = originalAppVersion;
    }
  });

  it("импорт модуля не имеет side-effect'ов: Sentry.init не вызывается до initSentry()", () => {
    // Act: ничего не вызываем — модуль уже импортирован наверху файла.
    // Assert: импорт сам по себе не инициализирует Sentry.
    expect(sentryMocks.init).not.toHaveBeenCalled();
  });

  it("initSentry без SENTRY_DSN не вызывает Sentry.init и логирует sentry_disabled_no_dsn", () => {
    // Arrange
    envMocks.SENTRY_DSN = "";
    // Act
    initSentry();
    // Assert
    expect(sentryMocks.init).not.toHaveBeenCalled();
    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "sentry_disabled_no_dsn"
    );
  });

  it("initSentry с SENTRY_DSN вызывает Sentry.init с ожидаемыми опциями", () => {
    // Arrange
    delete process.env.APP_VERSION;
    envMocks.SENTRY_DSN = TEST_DSN;
    // Act
    initSentry();
    // Assert
    expect(sentryMocks.init).toHaveBeenCalledTimes(1);
    const options = sentryMocks.init.mock.calls[0][0];
    expect(options).toMatchObject({
      dsn: TEST_DSN,
      environment: "test",
      release: "unknown",
      tracesSampleRate: 1.0, // не prod → полный трейсинг
      profilesSampleRate: 0,
    });
    expect(typeof options.beforeSend).toBe("function");

    // release берётся из APP_VERSION, если переменная задана
    process.env.APP_VERSION = "1.2.3";
    initSentry();
    expect(sentryMocks.init.mock.calls[1][0].release).toBe("1.2.3");
  });

  it("beforeSend вырезает PII: user, request headers/query_string, чувствительные ключи extra", () => {
    // Arrange
    envMocks.SENTRY_DSN = TEST_DSN;
    initSentry();
    const beforeSend = sentryMocks.init.mock.calls[0][0].beforeSend as (
      event: unknown
    ) => unknown;
    const event = {
      user: { id: "1", email: "a@b.c" },
      request: {
        url: "http://x",
        method: "GET",
        headers: { cookie: "secret" },
        query_string: "a=1",
      },
      extra: { userId: "1", token: "abc", password: "x", safe: true },
    } as unknown as Sentry.ErrorEvent;
    // Act
    const scrubbed = beforeSend(event) as {
      user?: unknown;
      request?: unknown;
      extra?: Record<string, unknown>;
    };
    // Assert
    expect(scrubbed.user).toEqual({});
    expect(scrubbed.request).toEqual({ url: "http://x", method: "GET" });
    expect(scrubbed.extra).toEqual({ userId: "1", safe: true });
  });

  it("beforeSend никогда не бросает (мусорный вход) и не трогает событие без PII", () => {
    // Arrange
    envMocks.SENTRY_DSN = TEST_DSN;
    initSentry();
    const beforeSend = sentryMocks.init.mock.calls[0][0].beforeSend as (
      event: unknown
    ) => unknown;
    // Act + Assert: любые аномалии проглатываются, вызов не падает
    expect(() => beforeSend(null)).not.toThrow();
    expect(() => beforeSend(undefined)).not.toThrow();
    expect(() => beforeSend({})).not.toThrow();
    // Событие без PII возвращается неизменным
    const clean = { extra: { safe: 1 } };
    expect(beforeSend(clean)).toEqual(clean);
  });

  it("captureWarning без DSN не вызывает Sentry.captureMessage и логирует warn", () => {
    // Arrange
    envMocks.SENTRY_DSN = "";
    // Act
    captureWarning("cache miss", {
      extra: { key: "users" },
      tags: { zone: "eu" },
    });
    // Assert
    expect(sentryMocks.captureMessage).not.toHaveBeenCalled();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      { message: "cache miss", extra: { key: "users" } },
      "sentry_warning_suppressed_no_dsn"
    );
  });

  it("captureWarning с DSN вызывает Sentry.captureMessage с level warning и контекстом", () => {
    // Arrange
    envMocks.SENTRY_DSN = TEST_DSN;
    // Act
    captureWarning("cache miss", {
      extra: { key: "users" },
      tags: { zone: "eu" },
    });
    // Assert
    expect(sentryMocks.captureMessage).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureMessage).toHaveBeenCalledWith("cache miss", {
      level: "warning",
      extra: { key: "users" },
      tags: { zone: "eu" },
    });
  });

  it("captureException без DSN не вызывает Sentry.captureException и логирует error", () => {
    // Arrange
    envMocks.SENTRY_DSN = "";
    const err = new Error("boom");
    // Act
    captureException(err, { extra: { op: "db" } });
    // Assert
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      { err, extra: { op: "db" } },
      "sentry_exception_suppressed_no_dsn"
    );
  });

  it("captureException с DSN пробрасывает исключение и контекст в Sentry", () => {
    // Arrange
    envMocks.SENTRY_DSN = TEST_DSN;
    const err = new Error("boom");
    const context = { extra: { op: "db" }, tags: { zone: "eu" } };
    // Act
    captureException(err, context);
    // Assert
    expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
    expect(sentryMocks.captureException).toHaveBeenCalledWith(err, context);
  });
});
