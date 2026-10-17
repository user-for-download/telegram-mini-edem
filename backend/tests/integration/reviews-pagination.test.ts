import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { db } from "../../src/db.js";

/**
 * Cursor-based пагинация GET /reviews/user/:userId.
 *
 * Паттерны репо (см. smoke.test.ts): app.request() вместо supertest,
 * dev-авторизация mock-токеном (tests/dev-mock-auth.js: allowlist + TTL),
 * уникальные telegramUserId.
 */
describe("GET /reviews/user/:userId — cursor pagination", () => {
  let targetUserId: string;
  // F14 partial unique index (authorId, targetUserId) WHERE tripId IS NULL:
  // каждому NULL-trip отзыву — свой автор, иначе второй INSERT → P2002.
  // targetUserId общий, чтобы пагинационные ассёрты (25 items) держались.
  let authorIds: string[];
  // telegramUserId — BigInt: безопасный счётчик вместо Date.now() (выходит за 32 бита).
  let tgSeq = 1_500_000n;

  beforeEach(async () => {
    const targetUser = await db.user.create({
      data: {
        name: `Target-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=1",
      },
    });
    targetUserId = targetUser.id;

    // 25 distinct authors — см. комментарий к authorIds выше.
    authorIds = [];
    for (let i = 0; i < 25; i++) {
      const author = await db.user.create({
        data: {
          name: `Author-${Date.now()}-${i}`,
          telegramUserId: ++tgSeq,
          avatar: "https://i.pravatar.cc/200?img=2",
        },
      });
      authorIds.push(author.id);
    }

    // 25 опубликованных отзывов с убывающими createdAt (сортировка по
    // createdAt desc). Статус — явно "published": публичный список
    // отдаёт только опубликованные, а дефолт схемы — "pending".
    for (let i = 0; i < 25; i++) {
      await db.review.create({
        data: {
          authorId: authorIds[i],
          targetUserId,
          targetRole: "driver",
          rating: (i % 5) + 1,
          text: `Review ${i}`,
          tripRoute: "Moscow → SPb",
          status: "published",
          createdAt: new Date(Date.now() - i * 1000),
        },
      });
    }
  });

  afterEach(async () => {
    await db.review.deleteMany({ where: { targetUserId } });
    await db.user.deleteMany({
      where: { id: { in: [targetUserId, ...authorIds] } },
    });
  });

  it("returns first page with default limit (20) and DESC order", async () => {
    const res = await app.request(`/api/v1/reviews/user/${targetUserId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(20);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.nextCursor).toBeDefined();
    expect(body.pagination.limit).toBe(20);

    // Новые отзывы идут первыми (createdAt desc) — text Review 0...Review 24.
    expect(body.items[0].text).toBe("Review 0");
  });

  it("respects custom limit", async () => {
    const res = await app.request(`/api/v1/reviews/user/${targetUserId}?limit=5`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(5);
    expect(body.pagination.hasMore).toBe(true);
    expect(body.pagination.limit).toBe(5);
  });

  it("clamps limit to max 50", async () => {
    const res = await app.request(`/api/v1/reviews/user/${targetUserId}?limit=100`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pagination.limit).toBe(50);
    expect(body.items).toHaveLength(25);
    expect(body.pagination.hasMore).toBe(false);
  });

  it("clamps limit to min 1", async () => {
    const res = await app.request(`/api/v1/reviews/user/${targetUserId}?limit=0`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.pagination.limit).toBe(1);
    expect(body.items).toHaveLength(1);
  });

  it("returns second page via cursor without overlap", async () => {
    const first = await (
      await app.request(`/api/v1/reviews/user/${targetUserId}?limit=10`)
    ).json();

    expect(first.items).toHaveLength(10);
    expect(first.pagination.hasMore).toBe(true);

    const second = await (
      await app.request(
        `/api/v1/reviews/user/${targetUserId}?limit=10&cursor=${first.pagination.nextCursor}`
      )
    ).json();

    expect(second.items).toHaveLength(10);

    const firstIds = new Set(first.items.map((r: { id: string }) => r.id));
    for (const item of second.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });

  it("returns empty page with 200 at the end of the list", async () => {
    const page1 = await (
      await app.request(`/api/v1/reviews/user/${targetUserId}?limit=10`)
    ).json();
    const page2 = await (
      await app.request(
        `/api/v1/reviews/user/${targetUserId}?limit=10&cursor=${page1.pagination.nextCursor}`
      )
    ).json();
    const page3 = await (
      await app.request(
        `/api/v1/reviews/user/${targetUserId}?limit=10&cursor=${page2.pagination.nextCursor}`
      )
    ).json();

    expect(page3.items).toHaveLength(5);
    expect(page3.pagination.hasMore).toBe(false);
    expect(page3.pagination.nextCursor).toBeNull();
  });

  it("returns empty page for a valid-format cursor that no longer exists", async () => {
    const fakeUuid = "00000000-0000-0000-0000-000000000000";
    const res = await app.request(
      `/api/v1/reviews/user/${targetUserId}?cursor=${fakeUuid}`
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items).toHaveLength(0);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.nextCursor).toBeNull();
  });

  it("rejects invalid cursor format with 400", async () => {
    const res = await app.request(
      `/api/v1/reviews/user/${targetUserId}?cursor=not-a-uuid`
    );
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.code).toBe("VALIDATION_FAILED");
  });

  it("returns 404 for non-existent user", async () => {
    const fakeUuid = "11111111-1111-1111-1111-111111111111";
    const res = await app.request(`/api/v1/reviews/user/${fakeUuid}`);
    expect(res.status).toBe(404);
  });

  it("rejects a cursor that belongs to another user's review with 400", async () => {
    const otherTarget = await db.user.create({
      data: {
        name: `OtherTarget-${Date.now()}`,
        telegramUserId: ++tgSeq,
        avatar: "https://i.pravatar.cc/200?img=3",
      },
    });
    const foreign = await db.review.create({
      data: {
        authorId: authorIds[0],
        targetUserId: otherTarget.id,
        targetRole: "driver",
        rating: 5,
        text: "Foreign",
        tripRoute: "Moscow → SPb",
        status: "published",
      },
    });

    try {
      const res = await app.request(
        `/api/v1/reviews/user/${targetUserId}?cursor=${foreign.id}`
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.code).toBe("VALIDATION_FAILED");
    } finally {
      await db.review.delete({ where: { id: foreign.id } });
      await db.user.delete({ where: { id: otherTarget.id } });
    }
  });
});
