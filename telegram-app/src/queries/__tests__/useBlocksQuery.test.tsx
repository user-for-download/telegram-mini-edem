// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { mockBlock } = vi.hoisted(() => ({ mockBlock: vi.fn() }));

vi.mock("@/api/blocks.api", () => ({
  blocksApi: {
    block: mockBlock,
    unblock: vi.fn(),
    list: vi.fn(),
    status: vi.fn(),
  },
}));

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBlockUserMutation } from "@/queries/useBlocksQuery";
import {
  BLOCK_KEYS,
  RIDE_REQUEST_KEYS,
  TRIP_KEYS,
} from "@/queries/keys";

function Probe() {
  const block = useBlockUserMutation();
  return (
    <button type="button" onClick={() => block.mutate("u-target")}>
      block
    </button>
  );
}

let client: QueryClient;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  mockBlock.mockResolvedValue({
    user: {
      id: "u-target",
      name: "Target",
      avatar: "https://t.me/i/userpic/320/test.svg",
      rating: 5,
      reviewsCount: 0,
      tripsCount: 0,
    },
    blockedAt: "2026-10-23T18:00:00.000Z",
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("useBlockUserMutation", () => {
  it("сбрасывает видимость поездок и обновляет собственный status", async () => {
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const reset = vi.spyOn(client, "resetQueries");
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      container.querySelector("button")?.click();
    });

    expect(mockBlock).toHaveBeenCalledWith("u-target");
    expect(client.getQueryData(BLOCK_KEYS.status("u-target"))).toEqual({
      blockedByMe: true,
    });
    expect(reset).toHaveBeenCalledWith({ queryKey: TRIP_KEYS.lists() });
    expect(reset).toHaveBeenCalledWith({ queryKey: TRIP_KEYS.details() });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: BLOCK_KEYS.lists(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: RIDE_REQUEST_KEYS.all,
    });
  });
});
