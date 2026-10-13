// Content-Type ставится только когда у запроса есть тело.
//
// Раньше doFetch начинал headers с жёсткого `Content-Type: application/json`,
// и каждый GET/DELETE без тела уходил с заголовком, который описывает
// нечего. Само по себе безобидно, но это ложь в запросе: прокси и CDN
// ориентируются на неё, а разработчик, читая перехват сети, видит тело там,
// где его нет.
//
// Явный Content-Type от вызывающего по-прежнему главнее: заголовки
// вызывающего сливаются ПОСЛЕ базового и перекрывают его.
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiClient } from "@/api/client";

const SCHEMA = z.object({ ok: z.boolean() });

function jsonFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

/** Заголовки, с которыми реально ушёл запрос. */
function sentHeaders(fetchMock: ReturnType<typeof vi.fn>): Headers {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return new Headers(init.headers);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Content-Type в doFetch", () => {
  it("GET без тела: заголовка нет", async () => {
    const fetchMock = jsonFetch();
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient().request("/trips", { method: "GET" }, SCHEMA);

    expect(sentHeaders(fetchMock).has("Content-Type")).toBe(false);
  });

  it("POST с телом: application/json на месте", async () => {
    const fetchMock = jsonFetch();
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient().request(
      "/trips",
      { method: "POST", body: JSON.stringify({ a: 1 }) },
      SCHEMA,
    );

    expect(sentHeaders(fetchMock).get("Content-Type")).toBe("application/json");
  });

  it("POST без тела: базовый заголовок не выдумывается", async () => {
    const fetchMock = jsonFetch();
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient().request("/trips/1/read", { method: "POST" }, SCHEMA);

    expect(sentHeaders(fetchMock).has("Content-Type")).toBe(false);
  });

  it("явный Content-Type вызывающего перекрывает базовый", async () => {
    const fetchMock = jsonFetch();
    vi.stubGlobal("fetch", fetchMock);

    await new ApiClient().request(
      "/upload",
      {
        method: "POST",
        body: "blob",
        headers: { "Content-Type": "application/octet-stream" },
      },
      SCHEMA,
    );

    expect(sentHeaders(fetchMock).get("Content-Type")).toBe(
      "application/octet-stream",
    );
  });

  it("Authorization не зависит от тела", async () => {
    const fetchMock = jsonFetch();
    vi.stubGlobal("fetch", fetchMock);
    const client = new ApiClient();
    client.setToken("t-1");

    await client.request("/trips", { method: "GET" }, SCHEMA);

    expect(sentHeaders(fetchMock).get("Authorization")).toBe("Bearer t-1");
  });
});
