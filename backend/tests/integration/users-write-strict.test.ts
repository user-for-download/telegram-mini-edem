import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";
import { devMockAccessToken } from "../dev-mock-auth.js";

/**
 * Строгость write-схем профиля (`.strict()`): неизвестные ключи должны
 * давать 400, а не молча игнорироваться. Это ловит опечатки в имени поля
 * (`nmae`, `notificationsEnabled` вместо `enabled` и т.п.), которые иначе
 * выглядели бы как «успешное» сохранение без изменения состояния.
 *
 * Паттерн репо: реальная БД, явная уборка.
 */
describe("write-схемы /users/me — strict", () => {
  let userId: string;
  let tgSeq = 8_300_000n;

  beforeEach(async () => {
    const user = await db.user.create({
      data: {
        name: `Strict user ${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "",
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await db.car.deleteMany({ where: { userId } });
    await db.user.deleteMany({ where: { id: userId } });
  });

  const auth = () => ({ Authorization: `Bearer ${devMockAccessToken(userId)}` });

  it("PATCH /users/me принимает известные поля", async () => {
    const res = await app.request("/api/v1/users/me", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Новое имя" }),
    });
    expect(res.status).toBe(200);
  });

  it("PATCH /users/me отвергает неизвестное поле (400)", async () => {
    const res = await app.request("/api/v1/users/me", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Новое имя", nmae: "опечатка" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /users/me/car отвергает неизвестное поле (400)", async () => {
    const res = await app.request("/api/v1/users/me/car", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ model: "Lada", color: "White", bogus: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /users/me/car принимает контрактные поля", async () => {
    const res = await app.request("/api/v1/users/me/car", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ model: "Lada", color: "White", plate: "A123BC" }),
    });
    expect(res.status).toBe(200);
  });

  it("PATCH /users/me/notification-settings отвергает неизвестное поле (400)", async () => {
    const res = await app.request("/api/v1/users/me/notification-settings", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ notificationsEnabled: true, extra: "nope" }),
    });
    expect(res.status).toBe(400);
  });
});
