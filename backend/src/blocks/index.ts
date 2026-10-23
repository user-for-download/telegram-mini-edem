import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import {
  userBlockListQuerySchema,
  userBlockTargetParamSchema,
} from "@edem/contracts";
import { db } from "../db.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import {
  mutationLimiter,
  publicReadLimiter,
} from "../middleware/rateLimit.js";
import { sanitizeValue } from "../middleware/sanitize.js";
import { serializePublicUser } from "../serializers/index.js";
import { ERROR_CODES } from "../errors.js";
import { wsManager } from "../ws/manager.js";

export const blocksRouter = new Hono<AuthEnv>();
blocksRouter.use("*", requireUser);

function parseTarget(userId: string | undefined) {
  return userBlockTargetParamSchema.safeParse({ userId });
}

function emitVisibilityChanged(firstUserId: string, secondUserId: string): void {
  wsManager.sendToUsers([firstUserId, secondUserId], {
    type: "visibility:changed",
    payload: { eventId: randomUUID() },
  });
}

blocksRouter.get("/", publicReadLimiter, async (c) => {
  const parsed = userBlockListQuerySchema.safeParse(
    sanitizeValue(c.req.query()),
  );
  if (!parsed.success) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid query",
        errors: z.formatError(parsed.error),
      },
      400,
    );
  }

  const blockerId = c.get("user").id;
  const { page, limit } = parsed.data;
  const where = { blockerId };
  const [rows, total] = await Promise.all([
    db.userBlock.findMany({
      where,
      include: { blocked: { include: { car: true } } },
      orderBy: [{ createdAt: "desc" }, { blockedId: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.userBlock.count({ where }),
  ]);

  return c.json({
    items: rows.map((row) => ({
      user: serializePublicUser(row.blocked),
      blockedAt: row.createdAt.toISOString(),
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  });
});

blocksRouter.get("/:userId", publicReadLimiter, async (c) => {
  const parsed = parseTarget(c.req.param("userId"));
  if (!parsed.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid user id" },
      400,
    );
  }

  const blockerId = c.get("user").id;
  const row = await db.userBlock.findUnique({
    where: {
      blockerId_blockedId: {
        blockerId,
        blockedId: parsed.data.userId,
      },
    },
    select: { blockerId: true },
  });
  return c.json({ blockedByMe: row !== null });
});

blocksRouter.put("/:userId", mutationLimiter, async (c) => {
  const parsed = parseTarget(c.req.param("userId"));
  if (!parsed.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid user id" },
      400,
    );
  }

  const blockerId = c.get("user").id;
  const blockedId = parsed.data.userId;
  if (blockedId === blockerId) {
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Cannot block yourself",
      },
      400,
    );
  }

  const result = await db.$transaction(
    async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: blockedId, deletedAt: null },
        include: { car: true },
      });
      if (!target) return null;

      const created = await tx.userBlock.createMany({
        data: [{ blockerId, blockedId }],
        skipDuplicates: true,
      });
      const row = await tx.userBlock.findUniqueOrThrow({
        where: { blockerId_blockedId: { blockerId, blockedId } },
      });
      return { target, row, created: created.count > 0 };
    },
    { isolationLevel: "Serializable" },
  );

  if (!result) {
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "User not found" },
      404,
    );
  }

  if (result.created) emitVisibilityChanged(blockerId, blockedId);

  return c.json({
    user: serializePublicUser(result.target),
    blockedAt: result.row.createdAt.toISOString(),
  });
});

blocksRouter.delete("/:userId", mutationLimiter, async (c) => {
  const parsed = parseTarget(c.req.param("userId"));
  if (!parsed.success) {
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid user id" },
      400,
    );
  }

  const blockerId = c.get("user").id;
  const blockedId = parsed.data.userId;
  const deleted = await db.userBlock.deleteMany({
    where: { blockerId, blockedId },
  });
  if (deleted.count > 0) emitVisibilityChanged(blockerId, blockedId);

  return c.json({ success: true });
});
