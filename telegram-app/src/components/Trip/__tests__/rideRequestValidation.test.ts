import { describe, expect, it } from "vitest";
import { validateRideRequestWindow } from "@/components/Trip/rideRequestValidation";

describe("validateRideRequestWindow", () => {
  it("принимает корректное окно", () => {
    expect(
      validateRideRequestWindow("2026-09-30T08:00", "2026-09-30T20:00"),
    ).toBeNull();
  });

  it("отклоняет невалидные даты по-русски", () => {
    expect(validateRideRequestWindow("", "2026-09-30T20:00")).toBe(
      "Выберите временной интервал",
    );
  });

  it("отклоняет «не позже» раньше «не раньше» по-русски", () => {
    expect(
      validateRideRequestWindow("2026-09-30T20:00", "2026-09-30T08:00"),
    ).toBe("«Не позже» должно быть позже «Не раньше»");
    expect(
      validateRideRequestWindow("2026-09-30T08:00", "2026-09-30T08:00"),
    ).toBe("«Не позже» должно быть позже «Не раньше»");
  });
});
