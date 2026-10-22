import { describe, expect, it } from "vitest";
import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_AUDIT_TARGET_TYPES,
  adminAuditActionSchema,
  adminAuditLogDtoSchema,
  adminAuditQuerySchema,
  adminAuditTargetTypeSchema,
  adminPaginatedAuditLogSchema,
  adminPaginatedReportsSchema,
  adminReportDtoSchema,
  adminReportTargetSummaryDtoSchema,
} from "../index.js";

const reportId = "11111111-1111-4111-8111-111111111111";

const baseReport = {
  id: reportId,
  targetType: "user" as const,
  targetId: "u-2",
  category: "spam" as const,
  description: "Спам в личных сообщениях",
  status: "pending" as const,
  resolutionNote: null,
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  resolvedAt: null,
};

const userSummary = {
  id: "u-2",
  targetType: "user" as const,
  label: "Мария Иванова",
  secondary: null,
  userId: "u-2",
  tripId: null,
  bookingId: null,
};

const adminReport = {
  ...baseReport,
  reporterId: "u-1",
  reporterName: "Иван Петров",
  adminActorId: null,
  adminActorType: null,
  adminActorName: null,
  targetLabel: "Пользователь",
  targetSummary: userSummary,
};

describe("adminReportTargetSummaryDtoSchema", () => {
  it("accepts user, trip and booking summaries", () => {
    const tripSummary = {
      id: "t-1",
      targetType: "trip" as const,
      label: "Москва → Тула",
      secondary: "active · 12 окт",
      userId: null,
      tripId: "t-1",
      bookingId: null,
    };
    const bookingSummary = {
      id: "b-1",
      targetType: "booking" as const,
      label: "Бронь: место 2",
      secondary: "confirmed",
      userId: null,
      tripId: "t-1",
      bookingId: "b-1",
    };

    expect(adminReportTargetSummaryDtoSchema.safeParse(userSummary).success).toBe(true);
    expect(adminReportTargetSummaryDtoSchema.safeParse(tripSummary).success).toBe(true);
    expect(adminReportTargetSummaryDtoSchema.safeParse(bookingSummary).success).toBe(true);
  });

  it("rejects an unknown target type", () => {
    const result = adminReportTargetSummaryDtoSchema.safeParse({
      ...userSummary,
      targetType: "car",
    });

    expect(result.success).toBe(false);
  });

  it("rejects non-string labels and missing relation fields", () => {
    expect(
      adminReportTargetSummaryDtoSchema.safeParse({ ...userSummary, label: 1 }).success,
    ).toBe(false);

    const { secondary: _omitted, ...withoutSecondary } = userSummary;
    expect(adminReportTargetSummaryDtoSchema.safeParse(withoutSecondary).success).toBe(
      false,
    );
  });

  it("rejects unknown fields (strict)", () => {
    const result = adminReportTargetSummaryDtoSchema.safeParse({
      ...userSummary,
      targetPhone: "+79990000000",
    });

    expect(result.success).toBe(false);
  });
});

describe("adminReportDtoSchema", () => {
  it("parses a report with reporter, actor and resolved target", () => {
    const result = adminReportDtoSchema.safeParse(adminReport);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.targetLabel).toBe("Пользователь");
      expect(result.data.targetSummary?.label).toBe("Мария Иванова");
    }
  });

  it("allows an unresolved target summary", () => {
    const result = adminReportDtoSchema.safeParse({
      ...adminReport,
      targetSummary: null,
      targetLabel: "Поездка",
    });

    expect(result.success).toBe(true);
  });

  it("requires targetLabel and targetSummary fields", () => {
    const { targetLabel: _label, ...withoutLabel } = adminReport;
    expect(adminReportDtoSchema.safeParse(withoutLabel).success).toBe(false);

    const { targetSummary: _summary, ...withoutSummary } = adminReport;
    expect(adminReportDtoSchema.safeParse(withoutSummary).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    const result = adminReportDtoSchema.safeParse({
      ...adminReport,
      reporterPhone: "+79990000000",
    });

    expect(result.success).toBe(false);
  });
});

describe("adminPaginatedReportsSchema", () => {
  it("parses the admin list pagination shape", () => {
    const result = adminPaginatedReportsSchema.safeParse({
      items: [adminReport],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown pagination envelope (strict)", () => {
    const result = adminPaginatedReportsSchema.safeParse({
      items: [adminReport],
      total: 1,
      page: 1,
      pageSize: 20,
      pagination: { hasMore: false },
    });

    expect(result.success).toBe(false);
  });
});

describe("admin audit enums", () => {
  it("accepts every documented action", () => {
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(adminAuditActionSchema.safeParse(action).success).toBe(true);
    }
  });

  it("rejects an undocumented action", () => {
    expect(adminAuditActionSchema.safeParse("user.delete").success).toBe(false);
  });

  it("accepts every documented target type and rejects unknown ones", () => {
    for (const targetType of ADMIN_AUDIT_TARGET_TYPES) {
      expect(adminAuditTargetTypeSchema.safeParse(targetType).success).toBe(true);
    }

    expect(adminAuditTargetTypeSchema.safeParse("payment").success).toBe(false);
  });
});

describe("adminAuditQuerySchema", () => {
  it("applies pagination defaults and keeps filters absent", () => {
    const result = adminAuditQuerySchema.parse({});

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.action).toBeUndefined();
    expect(result.targetType).toBeUndefined();
    expect(result.targetId).toBeUndefined();
  });

  it("parses action, targetType and trims targetId", () => {
    const result = adminAuditQuerySchema.parse({
      action: "report.status",
      targetType: "report",
      targetId: "  r-1  ",
      page: "2",
      pageSize: "50",
    });

    expect(result.targetId).toBe("r-1");
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(50);
  });

  it("rejects invalid enum filters", () => {
    expect(adminAuditQuerySchema.safeParse({ action: "report.delete" }).success).toBe(
      false,
    );
    expect(adminAuditQuerySchema.safeParse({ targetType: "payment" }).success).toBe(
      false,
    );
  });

  it("rejects unknown query fields (strict)", () => {
    const result = adminAuditQuerySchema.safeParse({ actorType: "admin" });

    expect(result.success).toBe(false);
  });

  it("rejects a pageSize above the admin cap", () => {
    const result = adminAuditQuerySchema.safeParse({ pageSize: "101" });

    expect(result.success).toBe(false);
  });
});

describe("adminAuditLogDtoSchema", () => {
  const log = {
    id: "a-1",
    action: "user.ban" as const,
    targetType: "user" as const,
    targetId: "u-2",
    metadata: { reason: "Спам", previousBannedAt: null },
    actorType: "admin" as const,
    createdAt: "2026-10-20T10:00:00.000Z",
  };

  it("parses metadata and allows a system actor without a target", () => {
    expect(adminAuditLogDtoSchema.safeParse(log).success).toBe(true);
    expect(
      adminAuditLogDtoSchema.safeParse({
        ...log,
        action: "city.recompute",
        targetType: "system",
        targetId: null,
        metadata: null,
        actorType: "system",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid action, actor type and timestamp", () => {
    expect(adminAuditLogDtoSchema.safeParse({ ...log, action: "user.delete" }).success).toBe(
      false,
    );
    expect(
      adminAuditLogDtoSchema.safeParse({ ...log, actorType: "bot" }).success,
    ).toBe(false);
    expect(
      adminAuditLogDtoSchema.safeParse({ ...log, createdAt: "вчера" }).success,
    ).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    const result = adminAuditLogDtoSchema.safeParse({
      ...log,
      actorId: "admin-1",
    });

    expect(result.success).toBe(false);
  });
});

describe("adminPaginatedAuditLogSchema", () => {
  const log = {
    id: "a-1",
    action: "city.create" as const,
    targetType: "city" as const,
    targetId: "c-1",
    metadata: { name: "Тула" },
    actorType: "admin" as const,
    createdAt: "2026-10-20T10:00:00.000Z",
  };

  it("parses the admin list pagination shape", () => {
    const result = adminPaginatedAuditLogSchema.safeParse({
      items: [log],
      total: 1,
      page: 1,
      pageSize: 20,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an unknown pagination envelope (strict)", () => {
    const result = adminPaginatedAuditLogSchema.safeParse({
      items: [log],
      total: 1,
      page: 1,
      pageSize: 20,
      pagination: { hasMore: false },
    });

    expect(result.success).toBe(false);
  });
});
