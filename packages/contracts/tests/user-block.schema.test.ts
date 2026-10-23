import { describe, expect, it } from "vitest";
import {
  blockedUserItemSchema,
  paginatedBlockedUsersSchema,
  userBlockListQuerySchema,
  userBlockStatusSchema,
  userBlockTargetParamSchema,
} from "../src/index.js";

const user = {
  id: "legacy-user-id",
  name: "Иван",
  avatar: "https://t.me/i/userpic/320/test.svg",
  rating: 5,
  reviewsCount: 0,
  tripsCount: 0,
};

describe("user-block contracts", () => {
  it("accepts a legacy user id and rejects unknown path fields", () => {
    expect(
      userBlockTargetParamSchema.parse({ userId: "legacy-user-id" }),
    ).toEqual({ userId: "legacy-user-id" });
    expect(
      userBlockTargetParamSchema.safeParse({ userId: "u-1", extra: true })
        .success,
    ).toBe(false);
  });

  it("coerces bounded pagination and stays strict", () => {
    expect(userBlockListQuerySchema.parse({ page: "2", limit: "10" })).toEqual(
      { page: 2, limit: 10 },
    );
    expect(userBlockListQuerySchema.safeParse({ limit: "51" }).success).toBe(
      false,
    );
    expect(
      userBlockListQuerySchema.safeParse({ page: "1", unknown: "x" })
        .success,
    ).toBe(false);
  });

  it("validates list items and pagination", () => {
    const item = blockedUserItemSchema.parse({
      user,
      blockedAt: "2026-10-23T18:00:00.000Z",
    });
    expect(
      paginatedBlockedUsersSchema.parse({
        items: [item],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
          hasMore: false,
        },
      }).items,
    ).toHaveLength(1);
  });

  it("exposes only blockedByMe, never the reverse relation", () => {
    expect(userBlockStatusSchema.parse({ blockedByMe: true })).toEqual({
      blockedByMe: true,
    });
    expect(
      Object.hasOwn(
        userBlockStatusSchema.parse({
          blockedByMe: false,
          blockedByOther: true,
        }),
        "blockedByOther",
      ),
    ).toBe(false);
  });
});
