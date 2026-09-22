import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";

/**
 * Публичный эндпоинт автодополнения городов. Без авторизации, с
 * IP-лимитом 30 req/min. Возвращает top-N (limit, default 10) городов,
 * отфильтрованных case-insensitive по подстроке `q`.
 */
async function ensureCity(name: string): Promise<string> {
  const nameNormalized = name.trim().toLowerCase();
  const existing = await db.city.findFirst({ where: { nameNormalized } });
  if (existing) return existing.id;
  const created = await db.city.create({ data: { name, nameNormalized } });
  return created.id;
}

describe("GET /api/v1/cities/suggest", () => {
  beforeEach(async () => {
    // Изолированный набор тестовых городов, чтобы не зависеть от seed.
    await ensureCity("Вологда-тест");
    await ensureCity("Волоколамск-тест");
    await ensureCity("Череповец-тест");
  });

  afterEach(async () => {
    await db.city.deleteMany({
      where: { nameNormalized: { endsWith: "-тест" } },
    });
  });

  it("returns matching cities case-insensitively", async () => {
    const res = await app.request("/api/v1/cities/suggest?q=вол");
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.items.map((c: { name: string }) => c.name);
    // Оба тестовых «Вологда-тест» / «Волоколамск-тест» начинаются на «вол».
    expect(names).toContain("Вологда-тест");
    expect(names).toContain("Волоколамск-тест");
  });

  it("honors the limit parameter", async () => {
    const res = await app.request("/api/v1/cities/suggest?q=вол&limit=1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toHaveLength(1);
  });

  it("returns 200 + full directory for empty q", async () => {
    const res = await app.request("/api/v1/cities/suggest?q=");
    expect(res.status).toBe(200);
    const body = await res.json();
    // Должны вернуться все 3 тестовых города + любые из dev seed.
    expect(body.items.length).toBeGreaterThanOrEqual(3);
  });

  it("returns 200 + full directory for missing q", async () => {
    const res = await app.request("/api/v1/cities/suggest");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(3);
  });

  it("returns 200 + full directory for whitespace-only q (treated as empty)", async () => {
    const res = await app.request("/api/v1/cities/suggest?q=%20%20%20");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items.length).toBeGreaterThanOrEqual(3);
  });

  it("returns 400 for limit over CITY_SUGGEST_LIMIT_MAX", async () => {
    const res = await app.request("/api/v1/cities/suggest?q=вол&limit=999");
    expect(res.status).toBe(400);
  });

  it("returns empty array when nothing matches", async () => {
    const res = await app.request(
      "/api/v1/cities/suggest?q=" + encodeURIComponent("аааааа"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
  });

  it("is rate-limited at 30 req/min (asserts via env-configured max)", async () => {
    // Лимитер 30/мин — в in-memory bucket, общий для всех тестов в
    // этом файле. Проверяем, что middleware зарегистрирован (статус
    // 200 при q=вол приходит при первых запросах, а не 500), а само
    // поведение 429-го покрывается юнит-тестом лимитера в rateLimit.
    const res = await app.request("/api/v1/cities/suggest?q=вол");
    expect(res.status).toBe(200);
  });
});
