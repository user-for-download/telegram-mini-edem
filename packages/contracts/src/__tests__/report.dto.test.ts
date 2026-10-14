import { describe, expect, it } from "vitest";
import {
  createReportDtoSchema,
  reportTargetSchema,
  reportTargetsSchema,
  updateReportStatusDtoSchema,
} from "../index.js";

const valid = {
  targetType: "trip",
  targetId: "11111111-1111-4111-8111-111111111111",
  category: "safety",
  description: "Опасное поведение водителя",
};

describe("Report contracts", () => {
  it("accepts and trims a report description", () => {
    expect(createReportDtoSchema.parse({ ...valid, description: "  Жалоба  " }).description).toBe("Жалоба");
  });

  it("accepts legacy opaque target IDs", () => {
    expect(createReportDtoSchema.parse({ ...valid, targetId: "t-1" }).targetId).toBe("t-1");
  });

  it("rejects invalid target/category and blank description", () => {
    expect(createReportDtoSchema.safeParse({ ...valid, targetType: "car", category: "abuse", description: " " }).success).toBe(false);
  });

  it("allows only moderation transitions", () => {
    expect(updateReportStatusDtoSchema.safeParse({ status: "pending" }).success).toBe(false);
    expect(updateReportStatusDtoSchema.safeParse({ status: "resolved", resolutionNote: "Готово" }).success).toBe(true);
  });
});

describe("Report targets contract", () => {
  const trip = { targetType: "trip", id: "t-1", fromCity: "Москва", toCity: "Тула", departureAt: "2026-10-12T09:00:00.000Z" };

  it("принимает поездку, бронь и человека", () => {
    const targets = [trip, { ...trip, targetType: "booking", id: "b-1" }, { targetType: "user", id: "u-1", name: "Иван" }];
    expect(reportTargetsSchema.safeParse(targets).success).toBe(true);
  });

  it("отвергает неизвестный тип, пустые поля и битую дату", () => {
    expect(reportTargetSchema.safeParse({ targetType: "car", id: "x" }).success).toBe(false);
    expect(reportTargetSchema.safeParse({ ...trip, id: "" }).success).toBe(false);
    expect(reportTargetSchema.safeParse({ ...trip, departureAt: "вчера" }).success).toBe(false);
    expect(reportTargetSchema.safeParse({ targetType: "user", id: "u-1", name: "" }).success).toBe(false);
  });
});
