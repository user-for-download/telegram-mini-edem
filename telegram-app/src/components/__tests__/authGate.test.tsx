// @vitest-environment jsdom
// B10: отсчёт 429-cooldown не должен крутить таймер после нуля.
// Прежняя реализация на setInterval тикала раз в секунду до ухода со
// экрана — на экране «Слишком много попыток входа» это минуты вхолостую.
//
// B12: у AuthStatus больше нет значения "error" — сбой авторизации это
// либо терминальный экран (banned/deleted), либо "unauthenticated" с
// lastAuthError. Здесь проверяем, что ветка общей ошибки достижима и
// показывает осмысленный текст, а не пустой экран.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

import { AuthGate } from "@/components/AuthGate";
import { useAuthStore } from "@/store/useAuthStore";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let queryClient: QueryClient;

function renderGate() {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root?.render(
      // QueryClientProvider нужен экрану бана: AppealForm — useMutation.
      <QueryClientProvider client={queryClient}>
        <AppRoot platform="base">
          <AuthGate>
            <div data-testid="app">приложение</div>
          </AuthGate>
        </AppRoot>
      </QueryClientProvider>,
    );
  });
}

/**
 * Отсчёт — цепочка setTimeout, каждый тик требует ререндера и нового
 * таймера. Одним advanceTimersByTimeAsync(60_000) React не успевает
 * перерендерить между тиками (срабатывает ровно один), поэтому шагаем
 * по секунде: так цепочка разворачивается полностью.
 */
async function tick(seconds: number): Promise<void> {
  for (let i = 0; i < seconds; i++) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  }
}

function text(): string {
  return document.body.textContent ?? "";
}

function resetStore(
  lastAuthError: {
    status?: number;
    code?: string;
    /** Сколько ждать по ответу лимитера; без него — запасные 60 с. */
    retryAfterMs?: number;
  } | null,
) {
  useAuthStore.setState({
    status: "unauthenticated",
    user: null,
    session: null,
    banReason: null,
    initData: null,
    lastAuthError,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
});

describe("AuthGate: 429-cooldown (B10)", () => {
  it("отсчёт доходит до нуля и таймер останавливается", async () => {
    resetStore({ status: 429 });
    renderGate();

    expect(text()).toContain("Слишком много попыток входа");
    expect(text()).toContain("Подождите 60 с");

    await tick(60);

    // Кнопка разблокирована — значит отсчёт дошёл до нуля.
    expect(text()).toContain("Попробовать снова");
    // Ключевое: таймеров не осталось. На setInterval здесь был бы 1.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("после нуля таймер не воскресает при тиках", async () => {
    resetStore({ status: 429 });
    renderGate();

    await tick(120);

    expect(vi.getTimerCount()).toBe(0);
    expect(text()).toContain("Попробовать снова");
  });

  it("не-429 отсчёт не запускает", async () => {
    resetStore(null);
    renderGate();

    expect(text()).toContain("Ошибка авторизации");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("отсчёт берётся из retryAfterMs, а не из жёстких 60 с", async () => {
    // Окно лимитера TG_AUTH_RATE_WINDOW_MS = 300 с: кнопка обязана оживать
    // вместе с блоком, а не раньше.
    resetStore({ status: 429, retryAfterMs: 300_000 });
    renderGate();

    expect(text()).toContain("Подождите 300 с");

    await tick(60);
    expect(text()).toContain("Подождите 240 с");

    await tick(240);
    expect(text()).toContain("Попробовать снова");
  });

  it("retryAfterMs округляется вверх до целых секунд", async () => {
    resetStore({ status: 429, retryAfterMs: 90_400 });
    renderGate();

    expect(text()).toContain("Подождите 91 с");
  });
});

describe("AuthGate: ветки без статуса error (B12)", () => {
  it("SESSION_EXPIRED — экран перевхода, ретрай доступен", () => {
    resetStore({ code: "SESSION_EXPIRED" });
    renderGate();

    expect(text()).toContain("Сессия завершилась");
    expect(text()).toContain("Войти снова");
  });

  it("INIT_DATA_UNAVAILABLE — понятный текст вместо пустого экрана", () => {
    resetStore({ code: "INIT_DATA_UNAVAILABLE" });
    renderGate();

    expect(text()).toContain("Не удалось получить данные Telegram");
  });

  it("общая ошибка авторизации — не битый экран", () => {
    resetStore(null);
    renderGate();

    expect(text()).toContain("Ошибка авторизации");
    expect(text()).toContain("Попробовать снова");
  });

  it("banned — экран бана с формой обжалования", () => {
    useAuthStore.setState({
      status: "banned",
      user: null,
      session: null,
      banReason: "Спам",
      initData: "auth_date=1&hash=x",
      lastAuthError: null,
    });
    renderGate();

    expect(text()).toContain("Аккаунт заблокирован");
    expect(text()).toContain("Обжалование блокировки");
  });

  it("deleted — экран удаления без обжалования", () => {
    useAuthStore.setState({
      status: "deleted",
      user: null,
      session: null,
      banReason: null,
      initData: null,
      lastAuthError: null,
    });
    renderGate();

    expect(text()).toContain("Профиль удалён");
    expect(text()).not.toContain("Обжалование блокировки");
  });
});
