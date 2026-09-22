import { describe, expect, it, vi } from "vitest";

// ADMIN_TOKEN и лимиты логина читаются из env при старте/импорте.
// Задаём до импорта app; лимит завышаем, чтобы тест не упёрся в 429.
vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-123";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { env } = await import("../../src/env.js");
const { signAccessToken } = await import("../../src/auth/tokens.js");

const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-123";

async function postLogin(token: string) {
  return app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token }),
  });
}

/** Достаёт значение cookie edem_admin_jwt из заголовка Set-Cookie. */
function extractAdminCookie(response: Response): string | null {
  const setCookieHeader = response.headers.get("set-cookie");
  if (!setCookieHeader) return null;
  const match = /edem_admin_jwt=([^;]+)/.exec(setCookieHeader);
  return match ? match[1] : null;
}

async function loginAndGetCookie(): Promise<string> {
  const response = await postLogin(ADMIN_TOKEN);
  const cookie = extractAdminCookie(response);
  if (!cookie) throw new Error("login did not set admin cookie");
  return cookie;
}

describe("admin auth: login", () => {
  it("wrong token -> 401 UNAUTHORIZED", async () => {
    const response = await postLogin("wrong-token");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("invalid body -> 400 VALIDATION_FAILED", async () => {
    const response = await app.request("/api/v1/admin/auth/login", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ nope: true }),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("valid token -> 200, expiresAt и httpOnly cookie", async () => {
    const before = Date.now();
    const response = await postLogin(ADMIN_TOKEN);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(typeof body.expiresAt).toBe("number");
    // TTL по умолчанию 12 часов: expiresAt в будущем, но не дальше 13 часов.
    expect(body.expiresAt).toBeGreaterThan(before);
    expect(body.expiresAt).toBeLessThan(before + 13 * 3600 * 1000);

    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain("edem_admin_jwt=");
    expect(setCookieHeader).toContain("HttpOnly");
    expect(setCookieHeader).toContain("SameSite=Lax");
    expect(setCookieHeader).toContain("Path=/");
  });

  it("ADMIN_TOKEN не задан -> 403 (панель выключена)", async () => {
    const original = env.ADMIN_TOKEN;
    try {
      env.ADMIN_TOKEN = "";
      const response = await postLogin(ADMIN_TOKEN);
      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body.code).toBe("FORBIDDEN");
    } finally {
      env.ADMIN_TOKEN = original;
    }
  });
});

describe("admin auth: Secure-флаг cookie (X-Forwarded-Proto)", () => {
  async function loginWithProto(
    proto: string | undefined
  ): Promise<string> {
    const headers: Record<string, string> = { ...JSON_HEADERS };
    if (proto !== undefined) headers["X-Forwarded-Proto"] = proto;
    const response = await app.request("/api/v1/admin/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: ADMIN_TOKEN }),
    });
    expect(response.status).toBe(200);
    return response.headers.get("set-cookie") ?? "";
  }

  it("без заголовка в не-production -> cookie без Secure", async () => {
    const setCookieHeader = await loginWithProto(undefined);
    expect(setCookieHeader).not.toContain("Secure");
  });

  it("X-Forwarded-Proto: https -> cookie с Secure даже вне production", async () => {
    const setCookieHeader = await loginWithProto("https");
    expect(setCookieHeader).toContain("Secure");
  });

  it("X-Forwarded-Proto: http -> cookie без Secure", async () => {
    const setCookieHeader = await loginWithProto("http");
    expect(setCookieHeader).not.toContain("Secure");
  });

  it("несколько хопов 'https, http' -> берётся первый (https)", async () => {
    const setCookieHeader = await loginWithProto("https, http");
    expect(setCookieHeader).toContain("Secure");
  });
});

describe("admin auth: session", () => {
  it("без cookie -> 200 { authenticated: false }", async () => {
    const response = await app.request("/api/v1/admin/auth/session");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, expiresAt: null });
  });

  it("с cookie после логина -> authenticated: true", async () => {
    const cookie = await loginAndGetCookie();
    const response = await app.request("/api/v1/admin/auth/session", {
      headers: { Cookie: `edem_admin_jwt=${cookie}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.authenticated).toBe(true);
    expect(typeof body.expiresAt).toBe("number");
  });

  it("мусор в cookie -> authenticated: false (всегда 200)", async () => {
    const response = await app.request("/api/v1/admin/auth/session", {
      headers: { Cookie: "edem_admin_jwt=not-a-jwt" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ authenticated: false, expiresAt: null });
  });
});

describe("admin auth: guard", () => {
  it("защищённый endpoint без cookie -> 401", async () => {
    const response = await app.request("/api/v1/admin/dashboard");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("UNAUTHORIZED");
  });

  it("защищённый endpoint с cookie -> 200", async () => {
    const cookie = await loginAndGetCookie();
    const response = await app.request("/api/v1/admin/dashboard", {
      headers: { Cookie: `edem_admin_jwt=${cookie}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.totalUsers).toBe("number");
  });

  it("поддельный JWT -> 401", async () => {
    const response = await app.request("/api/v1/admin/dashboard", {
      headers: { Cookie: "edem_admin_jwt=eyJhbGciOiJIUzI1NiJ9.eyJ0eXBlIjoiYWRtaW4tYWNjZXNzIn0.fake" },
    });
    expect(response.status).toBe(401);
  });

  it("обычный user access token (type=access) не проходит как админский", async () => {
    const userToken = await signAccessToken("some-user-id");
    const response = await app.request("/api/v1/admin/dashboard", {
      headers: { Cookie: `edem_admin_jwt=${userToken}` },
    });
    expect(response.status).toBe(401);
  });

  it("ADMIN_TOKEN не задан -> guard отвечает 403 даже с валидной cookie", async () => {
    const cookie = await loginAndGetCookie();
    const original = env.ADMIN_TOKEN;
    try {
      env.ADMIN_TOKEN = "";
      const response = await app.request("/api/v1/admin/dashboard", {
        headers: { Cookie: `edem_admin_jwt=${cookie}` },
      });
      expect(response.status).toBe(403);
    } finally {
      env.ADMIN_TOKEN = original;
    }
  });
});

describe("admin auth: logout", () => {
  it("logout -> 200 { ok: true } и cookie очищается", async () => {
    const response = await app.request("/api/v1/admin/auth/logout", {
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const setCookieHeader = response.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain("edem_admin_jwt=");
    // hono deleteCookie: пустое значение + Max-Age=0.
    expect(setCookieHeader).toContain("Max-Age=0");
  });

  it("logout идемпотентен без cookie", async () => {
    const first = await app.request("/api/v1/admin/auth/logout", { method: "POST" });
    const second = await app.request("/api/v1/admin/auth/logout", { method: "POST" });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });
});
