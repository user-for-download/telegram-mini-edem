import { describe, expect, it } from "vitest";
import {
  isRideRequestExpired,
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
  // min/max на <input type="number"> не запрещают ввод, только ограничивают
  // крутилки, так что ветка zod живая — сырое сообщение пользователю нельзя.
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

// Регресс H3: статус `expired` не пишет никто, кроме сида (ни воркер, ни
// админский маршрут). Просроченная заявка навсегда остаётся active/paused,
// а сервер отклоняет возврат в active с 409 (rideRequests/index.ts).
describe("isRideRequestExpired", () => {
  const NOW = new Date("2026-10-20T12:00:00.000Z");

  it("считает истёкшей заявку, чей срок прошёл", () => {
    expect(
      isRideRequestExpired({ expiresAt: "2026-10-20T11:59:00.000Z" }, NOW),
    ).toBe(true);
  });

  it("не трогает заявку со сроком в будущем", () => {
    expect(
      isRideRequestExpired({ expiresAt: "2026-10-20T12:00:01.000Z" }, NOW),
    ).toBe(false);
  });

  it("на границе срок уже истёк — ровно как решит сервер", () => {
    // Сервер отклоняет возврат в active при `expiresAt <= now`
    // (rideRequests/index.ts), поэтому на равенстве кнопку прячем: показать
    // её значит предложить действие, которое гарантированно даст 409.
    expect(
      isRideRequestExpired({ expiresAt: "2026-10-20T12:00:00.000Z" }, NOW),
    ).toBe(true);
  });

  it("неразобранный срок НЕ считаем истёкшим", () => {
    // Иначе скрыли бы действия у заявки, у которой срок просто не приехал.
    expect(isRideRequestExpired({ expiresAt: "" }, NOW)).toBe(false);
    expect(isRideRequestExpired({ expiresAt: "не дата" }, NOW)).toBe(false);
  });
});
