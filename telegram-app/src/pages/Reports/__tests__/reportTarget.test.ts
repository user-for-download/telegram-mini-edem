import { describe, expect, it } from "vitest";
import type { ReportTarget } from "@edem/contracts";
import {
  reportTargetKey,
  reportTargetLabel,
} from "@/pages/Reports/reportTarget";

const trip: ReportTarget = {
  targetType: "trip",
  id: "t-1",
  fromCity: "Москва",
  toCity: "Тула",
  departureAt: "2026-10-12T09:00:00.000Z",
};

const booking: ReportTarget = {
  targetType: "booking",
  id: "b-1",
  fromCity: "Москва",
  toCity: "Тула",
  departureAt: "2026-10-12T09:00:00.000Z",
};

const user: ReportTarget = {
  targetType: "user",
  id: "u-1",
  name: "Иван Петров",
};

describe("reportTargetKey", () => {
  it("склеивает тип и id — тип не отделим от объекта", () => {
    expect(reportTargetKey(trip)).toBe("trip:t-1");
    expect(reportTargetKey(booking)).toBe("booking:b-1");
    expect(reportTargetKey(user)).toBe("user:u-1");
  });
});

describe("reportTargetLabel", () => {
  it("поездка и бронь — тип, маршрут и дата по Москве", () => {
    expect(reportTargetLabel(trip)).toBe("Поездка: Москва → Тула, 12.10.2026");
    expect(reportTargetLabel(booking)).toBe("Бронь: Москва → Тула, 12.10.2026");
  });

  it("человек — тип и имя", () => {
    expect(reportTargetLabel(user)).toBe("Пользователь: Иван Петров");
  });
});
