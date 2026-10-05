import { describe, expect, it } from "vitest";
import { ApiError } from "@/api/client";
import { bookingErrorMessage, isAuthorizationError } from "@/helpers/bookingErrors";

describe("bookingErrorMessage", () => {
  it("maps seat-race conflicts to an actionable message", () => {
    expect(bookingErrorMessage(new ApiError("taken", "SEAT_TAKEN", 409))).toContain(
      "только что заняли",
    );
  });

  it("maps booking overlap to the bookings screen hint", () => {
    expect(
      bookingErrorMessage(new ApiError("overlap", "PASSENGER_BOOKING_OVERLAP", 409)),
    ).toContain("Мои брони");
  });

  it("maps a departed trip to the expired-trip message", () => {
    expect(bookingErrorMessage(new ApiError("past", "TRIP_IN_PAST", 400))).toContain(
      "уже отправилась",
    );
  });

  it("maps 403 without a code to the authorization message", () => {
    expect(bookingErrorMessage(new ApiError("Forbidden", undefined, 403))).toContain(
      "Нет доступа",
    );
  });

  it("maps 401 to the session message", () => {
    expect(bookingErrorMessage(new ApiError("Unauthorized", undefined, 401))).toContain(
      "Сессия истекла",
    );
  });

  it("прототипный код не возвращает функцию (рендер не упал бы)", () => {
    // Регрессия (аудит 2026-10-05): прямой индекс CODE_MESSAGES[code]
    // разрешал унаследованные члены Object.prototype. Для "toString" это
    // функция, она `!== undefined` — и значение уезжало в <Notice> как
    // React-ребёнок, что роняло рендер («Functions are not valid as a
    // React child»). Типы это не ловили: индекс-сигнатура объявляет
    // значение как string.
    for (const code of [
      "toString",
      "constructor",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      const message = bookingErrorMessage(new ApiError("x", code, 500));
      expect(typeof message).toBe("string");
      expect(message).not.toBe("");
      // Свой текст кода не подставляется — остаётся сообщение сервера.
      expect(message).toContain("x");
    }
  });

  it("falls back to a retry message for unknown errors", () => {
    expect(bookingErrorMessage(null)).toContain("повторите");
    expect(bookingErrorMessage(new Error("boom"))).toBe("boom");
  });
});

describe("isAuthorizationError", () => {
  it("detects 401/403 and FORBIDDEN codes", () => {
    expect(isAuthorizationError(new ApiError("x", "FORBIDDEN", 403))).toBe(true);
    expect(isAuthorizationError(new ApiError("x", undefined, 401))).toBe(true);
    expect(isAuthorizationError(new ApiError("x", "SEAT_TAKEN", 409))).toBe(false);
    expect(isAuthorizationError(new Error("x"))).toBe(false);
  });
});
