import { Hono } from "hono";
import { db } from "../db.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import {
  notificationReadLimiter,
  publicReadLimiter,
} from "../middleware/rateLimit.js";
import { z } from "zod";
import {
  notificationSchema,
  NOTIFICATION_ROLE_TYPES,
  notificationsPageSchema,
  notificationsQuerySchema,
} from "@edem/contracts";

export const notificationsRouter = new Hono<AuthEnv>();

const notificationCursorSchema = z.object({
  createdAt: z.string().datetime(),
  id: z.string().uuid(),
});

notificationsRouter.use("*", requireUser);

notificationsRouter.get("/my", publicReadLimiter, async (c) => {
  const user = c.get("user");
  const cursorStr = c.req.query("cursor");
  const limitRaw = Number(c.req.query("limit") || 20);
  const limit = Number.isInteger(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 50)
    : 20;

  // Серверный фильтр архивов (m3): клиент передаёт сегмент как есть,
  // по типам сам больше не фильтрует. Невалидный role — 400, а не молча всё.
  const filterParse = notificationsQuerySchema.safeParse({
    role: c.req.query("role") ?? undefined,
    unreadOnly: c.req.query("unreadOnly") ?? undefined,
  });
  if (!filterParse.success) {
    return c.json({ message: "Invalid query" }, 400);
  }
  const { role, unreadOnly } = filterParse.data;

  let cursor: { createdAt: Date; id: string } | undefined;
  if (cursorStr) {
    // Cap base64-курсора до декодирования: отсекаем заведомо мусорные
    // длинные строки до JSON.parse/Buffer (DoS-поверхность).
    if (cursorStr.length > 512) {
      return c.json({ message: "Invalid cursor" }, 400);
    }
    try {
      const parsed = JSON.parse(
        Buffer.from(cursorStr, "base64").toString("utf-8"),
      );
      const validated = notificationCursorSchema.parse(parsed);
      cursor = { createdAt: new Date(validated.createdAt), id: validated.id };
    } catch {
      return c.json({ message: "Invalid cursor" }, 400);
    }
  }

  const where: {
    userId: string;
    type?: { in: string[] };
    isRead?: boolean;
    OR?: Array<{
      createdAt: { lt: Date } | Date;
      id?: { lt: string };
    }>;
  } = { userId: user.id };
  if (role) {
    where.type = { in: [...NOTIFICATION_ROLE_TYPES[role]] };
  }
  if (unreadOnly) {
    where.isRead = false;
  }

  // Ручной keyset вместо Prisma cursor: курсорная строка обязана попадать
  // в where, а isRead меняется между страницами (прочтение) — Prisma cursor
  // на выбывшей строке ломается. Формат токена прежний {createdAt, id},
  // клиент не меняется.
  if (cursor) {
    where.OR = [
      { createdAt: { lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, id: { lt: cursor.id } },
    ];
  }

  const notifications = await db.notification.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });

  const hasMore = notifications.length > limit;
  const items = hasMore ? notifications.slice(0, limit) : notifications;

  let nextCursor: string | null = null;
  if (hasMore && items.length > 0) {
    const last = items[items.length - 1];
    nextCursor = Buffer.from(
      JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id }),
    ).toString("base64");
  }

  const unreadCount = await db.notification.count({
    where: { userId: user.id, isRead: false },
  });

  // Контракт ждёт даты ISO-строками (z.string().datetime()),
  // Prisma отдаёт Date — сериализуем до parse, иначе Zod бросает и роут
  // отвечает 500 на любой непустой inbox.
  const serialized = items.map((n) => ({
    ...n,
    createdAt: n.createdAt.toISOString(),
    tripDepartureAt: n.tripDepartureAt ? n.tripDepartureAt.toISOString() : null,
  }));
  return c.json(
    notificationsPageSchema.parse({
      items: serialized,
      nextCursor,
      unreadCount,
    }),
  );
});

notificationsRouter.patch("/:id/read", notificationReadLimiter, async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const notification = await db.notification.findUnique({ where: { id } });
  if (!notification || notification.userId !== user.id) {
    return c.json({ message: "Not found" }, 404);
  }

  const updated = await db.notification.update({
    where: { id },
    data: { isRead: true },
  });

  return c.json(
    notificationSchema.parse({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      tripDepartureAt: updated.tripDepartureAt
        ? updated.tripDepartureAt.toISOString()
        : null,
    }),
  );
});

notificationsRouter.patch("/read-all", notificationReadLimiter, async (c) => {
  const user = c.get("user");
  await db.notification.updateMany({
    where: { userId: user.id, isRead: false },
    data: { isRead: true },
  });
  return c.json({ success: true });
});
