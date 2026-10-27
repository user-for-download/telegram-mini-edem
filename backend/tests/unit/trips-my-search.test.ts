// Real trips router/auth/serializers, mocked DB only: no dev/test DB writes.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prisma } from "../../src/generated/prisma/client.js";
import type { PaginatedTripsResponse } from "@edem/contracts";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  count: vi.fn(),
  bookings: vi.fn(),
  user: vi.fn(),
}));

vi.mock("../../src/db.js", () => ({
  db: {
    trip: { findMany: mocks.findMany, count: mocks.count },
    booking: { findMany: mocks.bookings },
    user: { findUnique: mocks.user },
  },
}));

import { tripsRouter } from "../../src/trips/index.js";
import { signAccessToken } from "../../src/auth/tokens.js";
import { ERROR_CODES } from "../../src/errors.js";

const owner = {
  id: "owner",
  name: "Driver",
  avatar: "https://example.test/avatar.png",
  rating: 5,
  reviewsCount: 0,
  tripsCount: 0,
  isVerified: true,
  notificationsEnabled: true,
  verifiedAt: null,
  bannedAt: null,
  deletedAt: null,
  car: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function trip(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `trip-${String(index).padStart(3, "0")}`,
    driverId: owner.id,
    driver: owner,
    fromCity: "Москва",
    toCity: "Тула",
    fromAddress: "Meeting point",
    toAddress: "Destination",
    departureAt: new Date(Date.UTC(2030, 0, 1, index)),
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 3,
    durationMinutes: 120,
    distanceKm: 150,
    status: "active",
    tags: [],
    autoComplete: false,
    matchingEnabled: true,
    ...overrides,
  };
}

let rows: ReturnType<typeof trip>[];
let token: string;

// Evaluate only the router's DB predicate; escaped SQL wildcards are literals.
function filtered(where: Prisma.TripWhereInput = {}) {
  return rows.filter((row) => {
    if (where.driverId !== row.driverId) return false;
    if (typeof where.status === "string" && where.status !== row.status) return false;
    if (where.status && typeof where.status === "object" && where.status.in) {
      if (!(where.status.in as string[]).includes(row.status)) return false;
    }
    if (!where.OR) return true;
    return where.OR.some((clause) => {
      const field = clause.fromCity ? "fromCity" : "toCity";
      const filter = clause[field] as Prisma.StringFilter;
      const literal = String(filter.contains).replace(/\\([\\%_])/g, "$1");
      return row[field].toLowerCase().includes(literal.toLowerCase());
    });
  });
}

async function list(params: Record<string, string> = {}) {
  const response = await tripsRouter.request(`/my?${new URLSearchParams(params)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as PaginatedTripsResponse;
}

beforeEach(async () => {
  vi.clearAllMocks();
  rows = [];
  token = await signAccessToken(owner.id);
  mocks.user.mockResolvedValue(owner);
  mocks.bookings.mockResolvedValue([]);
  mocks.count.mockImplementation(async ({ where }: Prisma.TripCountArgs) => filtered(where).length);
  mocks.findMany.mockImplementation(async (args: Prisma.TripFindManyArgs) => {
    const order = Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy];
    const direction = order[0]?.departureAt === "asc" ? 1 : -1;
    const sorted = filtered(args.where).sort((a, b) =>
      direction * (a.departureAt.getTime() - b.departureAt.getTime()) ||
      (order.some((item) => item?.id) ? a.id.localeCompare(b.id) : 0),
    );
    const skip = args.skip ?? 0;
    return sorted.slice(skip, skip + (args.take ?? 20));
  });
});

describe("GET /trips/my search", () => {
  it("finds matches beyond the first unfiltered page; list/count share the own-user filter", async () => {
    rows = [
      ...Array.from({ length: 20 }, (_, index) => trip(index)),
      ...Array.from({ length: 21 }, (_, index) => trip(index + 20, { toCity: "Казань" })),
      trip(50, { driverId: "someone-else", toCity: "Казань" }),
      trip(51, { toCity: "Казань", status: "completed" }),
    ];
    const unfiltered = await list({ status: "active" });
    expect(unfiltered.items).toHaveLength(20);
    expect(unfiltered.items.every((item) => item.toCity === "Тула")).toBe(true);

    const first = await list({ status: "active", q: "  кАЗань  " });
    const second = await list({ status: "active", q: "  кАЗань  ", page: "2" });
    expect(first.items).toHaveLength(20);
    expect(first.pagination).toMatchObject({ total: 21, totalPages: 2, hasMore: true });
    expect(second.items.map((item) => item.id)).toEqual(["trip-040"]);
    expect(second.pagination).toMatchObject({ page: 2, total: 21, hasMore: false });
    const where = mocks.findMany.mock.calls.at(-1)?.[0].where;
    expect(where).toEqual({
      driverId: owner.id,
      status: "active",
      OR: [
        { fromCity: { contains: "кАЗань", mode: "insensitive" } },
        { toCity: { contains: "кАЗань", mode: "insensitive" } },
      ],
    });
    expect(mocks.count.mock.calls.at(-1)?.[0].where).toBe(where);
  });

  it("treats %_ as literal city text, not LIKE wildcards or an address match", async () => {
    rows = [
      trip(1, { fromCity: "Город %_" }),
      trip(2, { toCity: "Посёлок %_" }),
      trip(3, { fromAddress: "%_" }),
      trip(4),
    ];
    const result = await list({ status: "active", q: "%_" });
    expect(result.items.map((item) => item.id)).toEqual(["trip-001", "trip-002"]);
    expect(result.pagination.total).toBe(2);
    expect(mocks.findMany.mock.calls[0][0].where.OR).toEqual([
      { fromCity: { contains: "\\%\\_", mode: "insensitive" } },
      { toCity: { contains: "\\%\\_", mode: "insensitive" } },
    ]);
  });

  it("does not silently ignore an unknown route query", async () => {
    rows = [trip(1)];
    const result = await list({ q: "Unknown city" });
    expect(result.items).toEqual([]);
    expect(result.pagination).toMatchObject({ total: 0, totalPages: 0, hasMore: false });
  });

  it("rejects q over 100 characters before DB access and accepts the trimmed boundary", async () => {
    const response = await tripsRouter.request(`/my?q=${"x".repeat(101)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
    await list({ q: ` ${"x".repeat(100)} ` });
    expect(mocks.findMany.mock.calls[0][0].where.OR[0].fromCity.contains).toHaveLength(100);
  });

  it("whitespace q preserves an unfiltered own-user query", async () => {
    rows = [trip(1), trip(2, { driverId: "someone-else" })];
    const result = await list({ q: "   " });
    expect(result.items.map((item) => item.id)).toEqual(["trip-001"]);
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ driverId: owner.id });
  });

  it("paginates active chronologically with stable id ties", async () => {
    rows = [trip(2), trip(1), trip(3)].map((item) => ({
      ...item,
      departureAt: new Date("2030-01-01T00:00:00Z"),
    }));
    const first = await list({ status: "active", limit: "2" });
    const second = await list({ status: "active", limit: "2", page: "2" });
    expect([...first.items, ...second.items].map((item) => item.id)).toEqual([
      "trip-001", "trip-002", "trip-003",
    ]);
    expect(mocks.findMany.mock.calls[0][0].orderBy).toEqual([{ departureAt: "asc" }, { id: "asc" }]);
  });

  it.each([undefined, "archive"])("preserves descending ordering for status=%s", async (status) => {
    rows = [trip(1, { status: "completed" }), trip(2, { status: "cancelled" })];
    const result = await list(status ? { status } : {});
    expect(result.items.map((item) => item.id)).toEqual(["trip-002", "trip-001"]);
  });

  it("keeps authentication and account gates unchanged", async () => {
    const anonymous = await tripsRouter.request("/my?q=Москва");
    expect(anonymous.status).toBe(401);
    mocks.user.mockResolvedValue({ ...owner, bannedAt: new Date() });
    const banned = await tripsRouter.request("/my?q=Москва", {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(banned.status).toBe(403);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
