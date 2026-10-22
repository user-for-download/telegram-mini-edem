import { describe, expect, it } from "vitest";

import { buildUsersSearchParams } from "./api";

describe("buildUsersSearchParams", () => {
  it("keeps pagination and sends every active filter", () => {
    const params = buildUsersSearchParams({
      q: "  Иван  ",
      id: "user-1",
      telegramUserId: "9800001",
      phone: "+79990000000",
      page: 2,
      pageSize: 50,
    });

    expect(Object.fromEntries(params)).toEqual({
      page: "2",
      pageSize: "50",
      q: "Иван",
      id: "user-1",
      telegramUserId: "9800001",
      phone: "+79990000000",
    });
  });

  it("omits empty and whitespace-only filters", () => {
    const params = buildUsersSearchParams({
      q: "   ",
      id: "",
      telegramUserId: "  ",
      phone: "",
      page: 1,
      pageSize: 20,
    });

    expect(Object.fromEntries(params)).toEqual({
      page: "1",
      pageSize: "20",
    });
  });
});
