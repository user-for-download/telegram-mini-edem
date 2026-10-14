import { Hono } from "hono";
import { Prisma } from "../generated/prisma/client.js";
import {
  createReportDtoSchema,
  adminReportsQuerySchema,
  updateReportStatusDtoSchema,
  reportTargetsSchema,
  type ReportTarget,
} from "@edem/contracts";
import { db } from "../db.js";
import { logger } from "../logger.js";
import { reportServerError } from "../client-errors/index.js";
import { requireUser, type AuthEnv } from "../auth/middleware.js";
import { getSanitizedBody, sanitizeValue } from "../middleware/sanitize.js";
import {
  mutationLimiter,
  createUserRateLimiter,
  createRateLimiter,
  adminReadLimiter,
} from "../middleware/rateLimit.js";
import { ERROR_CODES } from "../errors.js";
import { devRateMax } from "../env.js";
import { adminGuard } from "../admin/guard.js";
import { serializeAdminReport, serializeReport } from "./serializers.js";

const reportLimiter = createUserRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: devRateMax(10),
  keyPrefix: "report-create",
});
const reportReadLimiter = createUserRateLimiter({
  windowMs: 60_000,
  max: devRateMax(60),
  keyPrefix: "report-read",
});
const reportAdminMutationLimiter = createRateLimiter({
  windowMs: 60_000,
  max: devRateMax(60),
  keyPrefix: "report-admin-mutation",
});
const includeRelations = { reporter: true, adminActor: true } as const;

export const reportsRouter = new Hono<AuthEnv>();
reportsRouter.use("*", requireUser);

async function canReport(
  userId: string,
  targetType: string,
  targetId: string,
): Promise<boolean> {
  if (targetType === "user") {
    if (targetId === userId) return false;
    const relationship = await db.booking.findFirst({
      where: {
        OR: [
          { passengerId: userId, trip: { driverId: targetId } },
          { passengerId: targetId, trip: { driverId: userId } },
        ],
      },
      select: { id: true },
    });
    return Boolean(relationship);
  }
  if (targetType === "trip") {
    // На свою поездку жаловаться нельзя: водитель исключён намеренно
    // (self-report, как и user→user на себя). Право — только у пассажиров
    // с бронью (любой статус — проверка связи, не активности).
    return Boolean(
      await db.trip.findFirst({
        where: {
          id: targetId,
          bookings: { some: { passengerId: userId } },
        },
        select: { id: true },
      }),
    );
  }
  if (targetType === "booking") {
    return Boolean(
      await db.booking.findFirst({
        where: {
          id: targetId,
          OR: [{ passengerId: userId }, { trip: { driverId: userId } }],
        },
        select: { id: true },
      }),
    );
  }
  return false;
}

reportsRouter.get("/", reportReadLimiter, async (c) => {
  const userId = c.get("user").id;
  // Backward-compat: массив (клиент и тест ждут array). Cap 50 последних.
  const items = await db.report.findMany({
    where: { reporterId: userId },
    include: includeRelations,
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return c.json(items.map(serializeReport));
});

/**
 * Кандидаты для формы жалобы — то, на что пользователь ВПРАВЕ жаловаться.
 *
 * Правила — те же, что у `canReport`: поездка, где я пассажир с бронью;
 * бронь, где я пассажир или водитель; человек, с которым есть общая бронь
 * (водитель ↔ пассажир). Поэтому «выбрал из списка» и «сервер принял»
 * совпадают, и UUID вводить руками не нужно.
 *
 * Берём 50 последних броней (как и список жалоб): жалоба — про недавнее, а
 * необозримый список старых поездок только мешает выбору. Записи
 * дедуплицируются: одна поездка/человек может встретиться в нескольких
 * бронях.
 */
reportsRouter.get("/targets", reportReadLimiter, async (c) => {
  const userId = c.get("user").id;
  const bookings = await db.booking.findMany({
    where: {
      OR: [{ passengerId: userId }, { trip: { driverId: userId } }],
    },
    include: {
      trip: {
        select: {
          id: true,
          fromCity: true,
          toCity: true,
          departureAt: true,
          driver: { select: { id: true, name: true } },
        },
      },
      passenger: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const targets: ReportTarget[] = [];
  const seen = new Set<string>();
  const push = (target: ReportTarget) => {
    const key = `${target.targetType}:${target.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(target);
  };

  for (const booking of bookings) {
    const route = {
      fromCity: booking.trip.fromCity,
      toCity: booking.trip.toCity,
      departureAt: booking.trip.departureAt.toISOString(),
    };
    // На поездку жалуются только пассажиры (canReport), поэтому водителю её
    // не предлагаем — иначе выбор упирался бы в 403 при отправке.
    if (booking.passengerId === userId) {
      push({ targetType: "trip", id: booking.trip.id, ...route });
    }
    push({ targetType: "booking", id: booking.id, ...route });
    // Человек — «другая сторона» брони: пассажиру водитель, водителю пассажир.
    const other =
      booking.passengerId === userId ? booking.trip.driver : booking.passenger;
    push({ targetType: "user", id: other.id, name: other.name });
  }

  const parsed = reportTargetsSchema.safeParse(targets);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues },
      "report_targets_response_validation_failed",
    );
    reportServerError(parsed.error, c.req.method, c.req.path);
    return c.json({ message: "Internal response validation failed" }, 500);
  }
  return c.json(parsed.data);
});

reportsRouter.post("/", mutationLimiter, reportLimiter, async (c) => {
  const parsed = createReportDtoSchema.safeParse(await getSanitizedBody(c));
  if (!parsed.success)
    return c.json(
      {
        code: ERROR_CODES.VALIDATION_FAILED,
        message: "Invalid report payload",
      },
      400,
    );
  const { targetType, targetId, category, description } = parsed.data;
  const userId = c.get("user").id;
  if (!(await canReport(userId, targetType, targetId)))
    return c.json(
      {
        code: ERROR_CODES.FORBIDDEN,
        message: "Report is not allowed in this context",
      },
      403,
    );
  let item;
  try {
    item = await db.$transaction(
      async (tx) => {
        // Лимит «1 жалоба навсегда»: любая жалоба этой тройки
        // (категория и статус не важны) блокирует повтор. Гонки
        // закрывает @@unique + catch P2002 ниже.
        const duplicate = await tx.report.findFirst({
          where: { reporterId: userId, targetType, targetId },
          select: { id: true },
        });
        if (duplicate) return null;
        return tx.report.create({
          data: {
            reporterId: userId,
            targetType,
            targetId,
            category,
            description,
          },
          include: includeRelations,
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2002") {
        return c.json(
          {
            code: ERROR_CODES.CONFLICT,
            message: "A report for this target already exists",
          },
          409,
        );
      }
      // P2034 — транзиентный serialization-конфликт, а НЕ «вечный дубликат»:
      // жалоба не создана, повтор безопасен. Если отдать её как «уже
      // существует», клиент не станет ретраить и потеряет первую жалобу.
      if (error.code === "P2034") {
        return c.json(
          {
            code: ERROR_CODES.CONFLICT,
            message: "Concurrent update conflict, please retry",
            retryable: true,
          },
          409,
        );
      }
    }
    throw error;
  }
  if (!item)
    return c.json(
      {
        code: ERROR_CODES.CONFLICT,
        message: "A report for this target already exists",
      },
      409,
    );
  return c.json(serializeReport(item), 201);
});

export const adminReportsRouter = new Hono();
adminReportsRouter.use("*", adminGuard);
adminReportsRouter.get("/", adminReadLimiter, async (c) => {
  const parsed = adminReportsQuerySchema.safeParse(
    sanitizeValue(c.req.query()),
  );
  if (!parsed.success)
    return c.json(
      { code: ERROR_CODES.VALIDATION_FAILED, message: "Invalid query" },
      400,
    );
  const { status, targetType, page, pageSize } = parsed.data;
  const where = {
    ...(status ? { status } : {}),
    ...(targetType ? { targetType } : {}),
  };
  const [items, total] = await Promise.all([
    db.report.findMany({
      where,
      include: includeRelations,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.report.count({ where }),
  ]);
  return c.json({
    items: items.map(serializeAdminReport),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      hasMore: page * pageSize < total,
    },
  });
});

adminReportsRouter.get("/:id", adminReadLimiter, async (c) => {
  const item = await db.report.findUnique({
    where: { id: c.req.param("id") },
    include: includeRelations,
  });
  if (!item)
    return c.json(
      { code: ERROR_CODES.NOT_FOUND, message: "Report not found" },
      404,
    );
  return c.json(serializeAdminReport(item));
});

adminReportsRouter.patch(
  "/:id/status",
  reportAdminMutationLimiter,
  async (c) => {
    const id = c.req.param("id");
    const parsed = updateReportStatusDtoSchema.safeParse(
      await getSanitizedBody(c),
    );
    if (!parsed.success)
      return c.json(
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          message: "Invalid report status payload",
        },
        400,
      );
    const current = await db.report.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Report not found" },
        404,
      );
    if (current.status === "resolved" || current.status === "rejected")
      return c.json(
        { code: ERROR_CODES.CONFLICT, message: "Report is already terminal" },
        409,
      );
    // Возврат в in_review очищает stale resolutionNote/resolvedAt: иначе
    // заметка от предыдущего решения переживала бы переоткрытие и вводила
    // в заблуждение (модератор видит чужой вердикт как текущий).
    const backToReview = parsed.data.status === "in_review";
    const item = await db.report.updateMany({
      where: { id, status: { in: ["pending", "in_review"] } },
      data: {
        status: parsed.data.status,
        resolutionNote: backToReview ? null : parsed.data.resolutionNote,
        resolvedAt:
          parsed.data.status === "resolved" || parsed.data.status === "rejected"
            ? new Date()
            : null,
        adminActorId: null,
        adminActorType: "admin",
      },
    });
    if (item.count !== 1)
      return c.json(
        { code: ERROR_CODES.CONFLICT, message: "Report was just changed" },
        409,
      );
    const updated = await db.report.findUnique({
      where: { id },
      include: includeRelations,
    });
    if (!updated)
      return c.json(
        { code: ERROR_CODES.NOT_FOUND, message: "Report not found" },
        404,
      );
    return c.json(serializeAdminReport(updated));
  },
);
