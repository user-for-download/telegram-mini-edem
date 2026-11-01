import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ADMIN_TOKEN читается из env при импорте — задаём до импорта app.
vi.hoisted(() => {
  process.env.ADMIN_TOKEN = "test-admin-token-cities";
  process.env.ADMIN_LOGIN_RATE_WINDOW_MS = "300000";
  process.env.ADMIN_LOGIN_RATE_MAX = "1000";
});

const { app } = await import("../../src/app.js");
const { db } = await import("../../src/db.js");
const { Prisma } = await import("../../src/generated/prisma/client.js");

const JSON_HEADERS = { "Content-Type": "application/json" };
const ADMIN_TOKEN = "test-admin-token-cities";

function extractAdminCookie(response: Response): string | null {
  const setCookieHeader = response.headers.get("set-cookie");
  if (!setCookieHeader) return null;
  const match = /edem_admin_jwt=([^;]+)/.exec(setCookieHeader);
  return match ? match[1] : null;
}

async function loginAndGetCookie(): Promise<string> {
  const response = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ token: ADMIN_TOKEN }),
  });
  const cookie = extractAdminCookie(response);
  if (!cookie) throw new Error("login did not set admin cookie");
  return cookie;
}

async function adminRequest(
  path: string,
  init: RequestInit,
  cookie?: string,
): Promise<Response> {
  // adminRouter смонтирован в app.ts под /api/v1/admin.
  const fullPath = path.startsWith("/") ? `/api/v1/admin${path}` : path;
  return app.request(fullPath, {
    ...init,
    headers: {
      ...JSON_HEADERS,
      ...(cookie ? { Cookie: `edem_admin_jwt=${cookie}` } : {}),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

describe("Admin cities CRUD", () => {
  let cookie: string;

  beforeEach(async () => {
    cookie = await loginAndGetCookie();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    // Удаляем тестовые города по уникальной метке.
    await db.city.deleteMany({
      where: { nameNormalized: { endsWith: "citiestest" } },
    });
  });

  it("rejects unauthenticated GET /admin/cities with 401", async () => {
    const res = await adminRequest("/cities", { method: "GET" });
    expect(res.status).toBe(401);
  });

  it("returns paginated list with q filter", async () => {
    await db.city.create({
      data: { name: "Алтай-citiestest", nameNormalized: "алтай-citiestest" },
    });
    await db.city.create({
      data: { name: "Байкал-citiestest", nameNormalized: "байкал-citiestest" },
    });
    const res = await adminRequest(
      "/cities?q=" + encodeURIComponent("алтай"),
      { method: "GET" },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.items.map((c: { name: string }) => c.name);
    expect(names).toContain("Алтай-citiestest");
    expect(names).not.toContain("Байкал-citiestest");
  });

  it.each([
    ["unknown parameter", "?unexpected=value"],
    ["repeated parameter", "?page=1&page=2"],
    ["malformed page", "?page=not-a-number"],
    // Граница контракта городов: ADMIN_CITY_PAGE_SIZE_MAX = 200
    // (у остальных админ-списков 100 — см. admin.schema.ts).
    ["pageSize above the contract limit", "?pageSize=201"],
  ])("rejects %s -> 400", async (_case, query) => {
    const res = await adminRequest("/cities" + query, { method: "GET" }, cookie);
    expect(res.status).toBe(400);
  });

  it("creates a new city (POST) and returns 201 with tripsCount=0", async () => {
    const res = await adminRequest(
      "/cities",
      {
        method: "POST",
        body: JSON.stringify({ name: "Новый-citiestest" }),
      },
      cookie,
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe("Новый-citiestest");
    expect(body.tripsCount).toBe(0);
  });

  it("rejects empty name on POST with 400", async () => {
    const res = await adminRequest(
      "/cities",
      {
        method: "POST",
        body: JSON.stringify({ name: "   " }),
      },
      cookie,
    );
    expect(res.status).toBe(400);
  });

  it("rejects duplicate name on POST with 409", async () => {
    await db.city.create({
      data: { name: "Дубликат-citiestest", nameNormalized: "дубликат-citiestest" },
    });
    const res = await adminRequest(
      "/cities",
      {
        method: "POST",
        body: JSON.stringify({ name: "  Дубликат-citiestest  " }),
      },
      cookie,
    );
    expect(res.status).toBe(409);
  });

  it("renames a city (PATCH)", async () => {
    const city = await db.city.create({
      data: { name: "Старое-citiestest", nameNormalized: "старое-citiestest" },
    });
    const res = await adminRequest(
      `/cities/${city.id}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: "Новое-citiestest" }),
      },
      cookie,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Новое-citiestest");
  });

  it("returns 404 on PATCH for missing city", async () => {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const res = await adminRequest(
      `/cities/${fakeId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ name: "X-citiestest" }),
      },
      cookie,
    );
    expect(res.status).toBe(404);
  });

  it("deletes a city with tripsCount=0", async () => {
    const city = await db.city.create({
      data: { name: "Удалить-citiestest", nameNormalized: "удалить-citiestest" },
    });
    const transaction = vi.spyOn(db, "$transaction");
    const rootLookup = vi.spyOn(db.city, "findUnique");
    const res = await adminRequest(
      `/cities/${city.id}`,
      { method: "DELETE" },
      cookie,
    );
    expect(res.status).toBe(200);
    // The reference check must not happen before the serializable transaction.
    expect(rootLookup).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    const after = await db.city.findUnique({ where: { id: city.id } });
    expect(after).toBeNull();
    const audit = await db.adminAuditLog.findFirst({
      where: { action: "city.delete", targetId: city.id },
    });
    expect(audit).toMatchObject({ targetType: "city", actorType: "admin" });
  });

  it.each([
    { prismaCode: "P2034", status: 409, code: "CONFLICT", retryable: true },
    { prismaCode: "P2025", status: 404, code: "NOT_FOUND", retryable: undefined },
  ])("maps deletion transaction $prismaCode to $status without deleting or auditing", async ({ prismaCode, status, code, retryable }) => {
    const city = await db.city.create({
      data: { name: "Конфликт-citiestest", nameNormalized: "конфликт-citiestest" },
    });
    vi.spyOn(db, "$transaction").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("City deletion conflict", {
        code: prismaCode,
        clientVersion: Prisma.prismaVersion.client,
      }),
    );

    const res = await adminRequest(`/cities/${city.id}`, { method: "DELETE" }, cookie);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({
      code,
      message: expect.any(String),
      ...(retryable ? { retryable } : {}),
    });
    expect(await db.city.findUnique({ where: { id: city.id } })).not.toBeNull();
    expect(await db.adminAuditLog.count({
      where: { action: "city.delete", targetId: city.id },
    })).toBe(0);
  });

  it("returns 409 on DELETE for a referenced city (tripsCount > 0)", async () => {
    const city = await db.city.create({
      data: { name: "С-поездкой-citiestest", nameNormalized: "с-поездкой-citiestest", tripsCount: 3 },
    });
    const res = await adminRequest(
      `/cities/${city.id}`,
      { method: "DELETE" },
      cookie,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/3 поездок/);
  });

  it("returns 404 on DELETE for missing city", async () => {
    const fakeId = "00000000-0000-4000-8000-000000000000";
    const res = await adminRequest(
      `/cities/${fakeId}`,
      { method: "DELETE" },
      cookie,
    );
    expect(res.status).toBe(404);
  });
});
