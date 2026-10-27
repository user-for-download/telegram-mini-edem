// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyTripsOptions } from "@/api/trips.api";
import type { PaginatedTripsResponse } from "@edem/contracts";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { getMyTrips } = vi.hoisted(() => ({ getMyTrips: vi.fn() }));
vi.mock("@/api/trips.api", () => ({ tripsApi: { getMyTrips } }));

import { useInfiniteMyTripsQuery } from "./useTripsQuery";
import { TRIP_KEYS } from "./keys";

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const results = new Map<string, ReturnType<typeof useInfiniteMyTripsQuery>>();

function page(options?: MyTripsOptions): PaginatedTripsResponse {
  return {
    items: [],
    pagination: {
      page: options?.page ?? 1,
      limit: 20,
      total: 21,
      totalPages: 2,
      hasMore: options?.page !== 2,
    },
  };
}

function Probe({ id, q }: { id: string; q?: string }) {
  const query = useInfiniteMyTripsQuery({ status: "active", q });
  useEffect(() => { results.set(id, query); }, [id, query]);
  return <div data-probe={id}>{query.data?.pageParams.join(",") ?? "loading"}</div>;
}

async function render(q?: string) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe id="home" />
        <Probe id="search" q={q} />
      </QueryClientProvider>,
    );
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  getMyTrips.mockReset();
  getMyTrips.mockImplementation(async (options?: MyTripsOptions) => page(options));
  results.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe("own-trip search query cache", () => {
  it("normalizes q in the cache key and request without changing the unfiltered Home query", async () => {
    await render("  КАЗАНЬ  ");
    await settle();
    expect(getMyTrips).toHaveBeenCalledWith(
      { status: "active", q: "казань", page: 1, limit: 20 }, expect.any(AbortSignal),
    );
    expect(getMyTrips).toHaveBeenCalledWith(
      { status: "active", q: undefined, page: 1, limit: 20 }, expect.any(AbortSignal),
    );
    expect(client.getQueryData([...TRIP_KEYS.my(), "infinite", "active", "казань"])).toBeDefined();
    expect(client.getQueryData([...TRIP_KEYS.my(), "infinite", "active", ""])).toBeDefined();
    const calls = getMyTrips.mock.calls.length;
    await render("казань ");
    await settle();
    expect(getMyTrips).toHaveBeenCalledTimes(calls);
  });

  it("a changed q starts page 1 without previous search pages, while Home keeps its pages", async () => {
    await render("Казань");
    await settle();
    await act(async () => {
      await results.get("search")?.fetchNextPage();
      await results.get("home")?.fetchNextPage();
    });
    await settle();
    expect(results.get("search")?.data?.pageParams).toEqual([1, 2]);
    expect(results.get("home")?.data?.pageParams).toEqual([1, 2]);

    let resolvePage: ((value: PaginatedTripsResponse) => void) | undefined;
    getMyTrips.mockImplementation((options?: MyTripsOptions) =>
      options?.q === "тула"
        ? new Promise<PaginatedTripsResponse>((resolve) => { resolvePage = resolve; })
        : Promise.resolve(page(options)),
    );
    await render("Тула");
    expect(results.get("search")?.data).toBeUndefined();
    expect(container.querySelector('[data-probe="search"]')?.textContent).toBe("loading");
    expect(results.get("home")?.data?.pageParams).toEqual([1, 2]);
    expect(getMyTrips.mock.calls.at(-1)?.[0]).toMatchObject({ q: "тула", page: 1 });
    await act(async () => resolvePage?.(page({ q: "тула" })));
    await settle();
    expect(results.get("search")?.data?.pageParams).toEqual([1]);
    await render("   ");
    expect(results.get("search")?.data?.pageParams).toEqual([1, 2]);
    expect(results.get("search")?.data).toBe(results.get("home")?.data);
  });
});
