import { describe, expect, it } from "vitest";
import { isWsOriginPermitted } from "../../src/ws/origin.js";

const CORS = "http://localhost:3000,http://127.0.0.1:3000";

function check(overrides: {
  origin?: string;
  host?: string;
  forwardedHost?: string;
  corsOrigins?: string;
}): boolean {
  return isWsOriginPermitted({
    origin: overrides.origin ?? "https://tg-dev.biet.site",
    host: overrides.host,
    forwardedHost: overrides.forwardedHost,
    corsOrigins: overrides.corsOrigins ?? CORS,
  });
}

describe("WS Origin (CSWSH) check", () => {
  it("allows same-origin without a proxy", () => {
    expect(check({ host: "tg-dev.biet.site" })).toBe(true);
  });

  it("allows same-origin behind a proxy that rewrites Host", () => {
    // Vite `changeOrigin: true`: Host = backend target, XFH = исходный домен.
    expect(
      check({
        host: "127.0.0.1:3011",
        forwardedHost: "tg-dev.biet.site",
      })
    ).toBe(true);
  });

  it("rejects a mismatched Origin when only the proxy Host is known", () => {
    expect(
      check({
        host: "127.0.0.1:3011",
        forwardedHost: "evil.example",
      })
    ).toBe(false);
  });

  it("rejects a cross-site Origin even with a rewritten Host", () => {
    expect(
      check({
        origin: "https://evil.example",
        host: "127.0.0.1:3011",
        forwardedHost: "tg-dev.biet.site",
      })
    ).toBe(false);
  });

  it("compares hosts case-insensitively", () => {
    expect(
      check({ origin: "https://TG-DEV.BIET.SITE", host: "TG-DEV.BIET.SITE" })
    ).toBe(true);
    expect(
      check({
        host: "127.0.0.1:3011",
        forwardedHost: "TG-DEV.BIET.SITE",
      })
    ).toBe(true);
  });

  it("keeps the CORS_ORIGINS allowlist as a fallback", () => {
    expect(check({ origin: "http://localhost:3000" })).toBe(true);
    expect(check({ origin: "http://127.0.0.1:3000" })).toBe(true);
    expect(
      check({
        origin: "http://localhost:3000",
        corsOrigins: " http://localhost:3000 , ",
      })
    ).toBe(true);
  });

  it("does not allow an Origin outside the allowlist", () => {
    expect(check({ origin: "https://evil.example" })).toBe(false);
  });

  it("rejects a malformed Origin", () => {
    expect(check({ origin: "not a url" })).toBe(false);
    expect(check({ origin: "" })).toBe(false);
  });

  it("treats an empty X-Forwarded-Host as absent", () => {
    expect(
      check({ host: "127.0.0.1:3011", forwardedHost: undefined })
    ).toBe(false);
  });
});
