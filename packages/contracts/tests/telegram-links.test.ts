import { describe, expect, it } from "vitest";
import { buildTelegramStartParam, resolveTelegramStartParam, TELEGRAM_START_PARAM_ROUTES } from "../src/telegram-links.js";

const id = "123e4567-e89b-42d3-a456-426614174000";
describe("Telegram launch route protocol", () => {
  it.each(Object.values(TELEGRAM_START_PARAM_ROUTES))("round trips %s", route => {
    expect(resolveTelegramStartParam(buildTelegramStartParam(route))).toBe(route);
  });
  it.each([`/trips/${id}`, `/trips/my/${id}/requests`])("round trips entity route %s", route => {
    expect(resolveTelegramStartParam(buildTelegramStartParam(route))).toBe(route);
  });
  it("normalizes legacy aliases", () => {
    expect(resolveTelegramStartParam(buildTelegramStartParam("/trips/my"))).toBe("/bookings?segment=driving");
    expect(resolveTelegramStartParam(buildTelegramStartParam("/bookings/history"))).toBe("/profile/history");
  });
  it.each(["__proto__", "constructor", "requests_invalid", "trip_invalid"])("rejects invalid token %s", token => {
    expect(resolveTelegramStartParam(token)).toBe("/trips");
  });
  it("does not serialize unknown or private routes", () => {
    expect(buildTelegramStartParam("/users/secret?token=private")).toBe("notifications");
  });
});
