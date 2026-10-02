import { describe, expect, it } from "vitest";
import {
  rideRequestErrorMessage,
  validateRideRequestWindow,
} from "@/components/Trip/rideRequestValidation";

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

describe("rideRequestErrorMessage: перевод zod в русский + поле", () => {
  // Основание 2026-10-02: сырое сообщение Zod показывалось пользователю —
  // «Too big: expected number to be <=3». min/max на <input type="number">
  // не запрещают ввод, только ограничивают крутилки, так что ветка живая.
  it("seats → поле «Места» формы создания", () => {
    expect(rideRequestErrorMessage(["seats"])).toEqual({
      field: "ride-seats",
      message: "Мест может быть от 1 до 3",
    });
  });

  it("seats в инлайн-правке → поле с id запроса", () => {
    expect(rideRequestErrorMessage(["seats"], "abc-123")).toEqual({
      field: "ride-edit-seats-abc-123",
      message: "Мест может быть от 1 до 3",
    });
  });

  it("города и окно переводятся на русский", () => {
    // Сообщения схемы записаны по-английски: «Cities must be different».
    expect(rideRequestErrorMessage(["fromCityId"]).message).toBe(
      "Города отправления и прибытия должны различаться",
    );
    expect(rideRequestErrorMessage(["latestAt"])).toEqual({
      field: "ride-latest",
      message: "«Не позже» должно быть позже «Не раньше»",
    });
  });

  it("неизвестный путь не придумывает поле", () => {
    expect(rideRequestErrorMessage(["что-то"])).toEqual({
      field: null,
      message: "Проверьте параметры запроса",
    });
  });

  it("ни один текст не английский", () => {
    for (const path of [["seats"], ["fromCityId"], ["toCityId"], ["earliestAt"], ["latestAt"], ["expiresAt"], ["x"]]) {
      expect(rideRequestErrorMessage(path).message).not.toMatch(/[A-Za-z]{4,}/);
    }
  });
});
