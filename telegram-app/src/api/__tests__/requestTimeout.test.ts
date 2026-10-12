import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiError } from "@/api/client";
import { z } from "zod";

/**
 * Регресс L3: таймаут запроса покрывал только ЗАГОЛОВКИ.
 *
 * `clearTimeout` стоял в `finally` у `fetch`, то есть снимался сразу после
 * прихода ответа. Дальше `response.json()` шёл уже без таймера, и сценарий
 * «бэкенд отдал заголовки и завис на теле» — обычное дело в мобильной сети —
 * оставлял мутацию навсегда в isPending: кнопка отправки заблокирована,
 * а ветка «Таймаут запроса» не срабатывала НИКОГДА.
 */
const SCHEMA = z.object({ ok: z.boolean() });

/**
 * Ответ, который отдаёт заголовки сразу, а тело — до отмены сигнала.
 *
 * Стаб обязан слушать `init.signal`: настоящий fetch при abort рвёт поток
 * тела, и без этого тест измерял бы не продукт, а мок.
 */
function stalledBodyFetch() {
  return vi.fn((_url: string, init?: RequestInit) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const signal = init?.signal;
        if (!signal) return;
        if (signal.aborted) {
          controller.error(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => controller.error(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        // Тело намеренно не кладём и НЕ закрываем — оно «висит».
      },
    });
    return Promise.resolve(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Таймаут покрывает чтение тела, а не только заголовки", () => {
  it("зависшее тело даёт REQUEST_TIMEOUT, а не вечное ожидание", async () => {
    vi.useFakeTimers();
    const client = new ApiClient();
    vi.stubGlobal("fetch", stalledBodyFetch());

    const pending = client
      .request("/trips", { method: "GET" }, SCHEMA)
      .catch((error: unknown) => error);

    // Прокручиваем время заведомо за пределы таймаута.
    await vi.advanceTimersByTimeAsync(20_000);

    const error = await pending;
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("REQUEST_TIMEOUT");
    vi.unstubAllGlobals();
  });

  it("обычный успешный ответ по-прежнему разбирается", async () => {
    const client = new ApiClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(client.request("/trips", { method: "GET" }, SCHEMA)).resolves.toEqual({
      ok: true,
    });
    vi.unstubAllGlobals();
  });

  it("204 без тела не превращается в синтетический 502", async () => {
    // Раньше `response.json()` на пустом теле падал, и успешный DELETE/204
    // отдавал «Invalid server response» вместо успеха.
    const client = new ApiClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(
      client.request("/bookings/x", { method: "DELETE" }, z.unknown()),
    ).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });
});

/**
 * Регресс на утечку, которую внесла правка таймаута.
 *
 * Таймер тела живёт до `parseResponse`, но не-2xx ответ читается мимо него
 * (`errorFromResponse`), как и первый ответ при 401-повторе. Если в этих
 * ветках таймер и слушатель отмены не снять, каждый неудачный запрос держит
 * 15-секундный таймер и слушатель на СИГНАЛЕ ВЫЗЫВАЮЩЕГО. Сигнал обычно
 * переиспользуется (контроллер запроса на компоненте), поэтому слушатели
 * накапливались и держали замыкания.
 */
describe("Утечки таймера тела на путях мимо parseResponse", () => {
  /** Считает, сколько раз signal побывал в add/removeEventListener. */
  function trackingSignal() {
    const controller = new AbortController();
    const listeners = new Set<unknown>();
    const original = controller.signal.addEventListener.bind(controller.signal);
    const remove = controller.signal.removeEventListener.bind(
      controller.signal,
    );
    controller.signal.addEventListener = ((...args: unknown[]) => {
      listeners.add(args[1]);
      return (original as (...a: unknown[]) => void)(...args);
    }) as typeof controller.signal.addEventListener;
    controller.signal.removeEventListener = ((...args: unknown[]) => {
      listeners.delete(args[1]);
      return (remove as (...a: unknown[]) => void)(...args);
    }) as typeof controller.signal.removeEventListener;
    return { signal: controller.signal, pending: () => listeners.size };
  }

  it("не-2xx снимает и таймер, и слушатель отмены", async () => {
    const client = new ApiClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "nope", code: "CONFLICT" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const tracked = trackingSignal();

    await expect(
      client.request("/trips", { method: "GET", signal: tracked.signal }, SCHEMA),
    ).rejects.toBeInstanceOf(ApiError);

    expect(tracked.pending()).toBe(0);
    vi.unstubAllGlobals();
  });

  it("таймаут не остаётся висеть после ошибки (прокручиваем часы)", async () => {
    vi.useFakeTimers();
    const client = new ApiClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const abortSpy = vi.fn();

    const pending = client
      .request("/trips", { method: "GET", signal: AbortSignal.abort(abortSpy as never) }, SCHEMA)
      .catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    await pending;

    // Таймер уже снят: 15-секундный abort контроллера не должен был сработать.
    expect(abortSpy).not.toHaveBeenCalled();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
