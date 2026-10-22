import { describe, expect, it } from "vitest";

import { buildReportsSearchParams } from "./api";

describe("buildReportsSearchParams", () => {
  it("keeps pagination and sends active status/targetType filters", () => {
    const params = buildReportsSearchParams({
      status: "in_review",
      targetType: "trip",
      page: 3,
      pageSize: 20,
    });

    expect(Object.fromEntries(params)).toEqual({
      page: "3",
      pageSize: "20",
      status: "in_review",
      targetType: "trip",
    });
  });

  it("omits filters that are not set", () => {
    const params = buildReportsSearchParams({ page: 1, pageSize: 20 });

    expect(Object.fromEntries(params)).toEqual({
      page: "1",
      pageSize: "20",
    });
  });
});
