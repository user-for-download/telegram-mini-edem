import { describe, expect, it } from "vitest";
import { wsServerEventSchema } from "../src/index.js";

describe("wsServerEventSchema", () => {
  it("accepts the authentication acknowledgement", () => {
    expect(wsServerEventSchema.parse({ type: "auth:ok" })).toEqual({ type: "auth:ok" });
  });

  it("rejects malformed event payloads", () => {
    expect(
      wsServerEventSchema.safeParse({ type: "booking:new", payload: { bookingId: 1 } }).success,
    ).toBe(false);
  });

  it("accepts opaque visibility cache hints", () => {
    expect(
      wsServerEventSchema.parse({
        type: "visibility:changed",
        payload: { eventId: "00000000-0000-4000-8000-000000000001" },
      }),
    ).toEqual({
      type: "visibility:changed",
      payload: { eventId: "00000000-0000-4000-8000-000000000001" },
    });
    expect(
      wsServerEventSchema.safeParse({
        type: "visibility:changed",
        payload: { eventId: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });
});
