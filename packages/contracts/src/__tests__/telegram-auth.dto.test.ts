import { describe, expect, it } from "vitest";
import { telegramAuthRequestSchema } from "../index.js";

/**
 * Telegram auth контракт: RAW initData строка как пришла от Telegram
 * (никакой пересортировки ключей — иначе HMAC валидация на сервере
 * не сойдётся). Границы длины — под реальную initData (~1-2 КБ, cap 4096).
 */
describe("Telegram auth contracts", () => {
  it("accepts raw init data string", () => {
    const initData =
      "auth_date=1662771648&query_id=AAHdF6IQAAAAAN0XohDhrOrc" +
      "&user=%7B%22id%22%3A279058397%7D&hash=c501b71e";
    expect(telegramAuthRequestSchema.parse({ initData })).toEqual({ initData });
  });

  it("rejects empty init data", () => {
    expect(
      telegramAuthRequestSchema.safeParse({ initData: "" }).success
    ).toBe(false);
  });

  it("rejects missing init data", () => {
    expect(telegramAuthRequestSchema.safeParse({}).success).toBe(false);
  });

  it("rejects init data over 4096 chars", () => {
    expect(
      telegramAuthRequestSchema.safeParse({ initData: "a".repeat(4097) }).success
    ).toBe(false);
  });

  it("accepts exactly 4096 chars (boundary)", () => {
    expect(
      telegramAuthRequestSchema.safeParse({ initData: "a".repeat(4096) }).success
    ).toBe(true);
  });

  it("rejects non-string init data", () => {
    expect(
      telegramAuthRequestSchema.safeParse({ initData: 12345 }).success
    ).toBe(false);
  });
});
