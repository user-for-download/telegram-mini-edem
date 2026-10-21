import { describe, expect, it } from "vitest";
import {
  redactSensitivePath,
  redactSensitiveUrl,
} from "../../src/utils/redact.js";

describe("utils/redact", () => {
  it("скрывает секрет webhook-бота в path", () => {
    expect(redactSensitivePath("/api/v1/bot/webhook/super-secret")).toBe(
      "/api/v1/bot/webhook/[redacted]",
    );
  });

  it("не трогает обычные пути", () => {
    expect(redactSensitivePath("/api/v1/trips/123")).toBe("/api/v1/trips/123");
  });

  it("скрывает секрет в абсолютном URL и query", () => {
    expect(
      redactSensitiveUrl(
        "https://api.example/bot/webhook/super-secret?foo=bar",
      ),
    ).toBe("https://api.example/bot/webhook/[redacted]?foo=bar");
  });
});
