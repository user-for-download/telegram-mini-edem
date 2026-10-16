// @vitest-environment jsdom
// F22: скелетоны списков обязаны уважать prefers-reduced-motion.
//
// Кит вешает на Skeleton бесконечную пульсацию 1.8s через
// `.tgui-…:not(.tgui-…):after` — анимация включается ОТСУТСТВИЕМ
// второго хеш-класса, который добавляет проп withoutAnimation. Поэтому
// проверять надо не «есть ли анимация в CSS» (её в jsdom всё равно нет),
// а на каком узле оказывается этот класс.
//
// Хеш кита меняется от версии к версии, поэтому эталон «анимация
// выключена» берётся КОНТРОЛЬНЫМ РЕНДЕРОМ самого Skeleton, а не
// константой: тест переживёт обновление кита и не станет проверять
// собственную константу против самой себя.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { Skeleton } from "@telegram-apps/telegram-ui";

import {
  NotificationCardSkeleton,
  ProfileBarSkeleton,
  ReviewCardSkeleton,
  TripCardSkeleton,
} from "@/components/Skeletons";

const REDUCE_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Стаб matchMedia с управляемым matches: даёт и «включено», и
 *  «выключено», и смену на лету. Настоящий jsdom-совместимый
 *  MediaQueryList без стаба не считает запросы и всегда даёт false —
 *  на него опереться нельзя. */
function stubMatchMedia(initialMatches: boolean) {
  const state = { matches: initialMatches };
  const listeners = new Set<() => void>();

  const makeList = (media: string) =>
    ({
      get matches() {
        return state.matches;
      },
      media,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: () => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: () => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: () => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;

  vi.stubGlobal("matchMedia", vi.fn(makeList));

  return {
    queries: () => (window.matchMedia as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0] as string),
    /** Переключить настройку ОС на лету и разбудить подписчиков. */
    set(next: boolean) {
      state.matches = next;
      act(() => {
        listeners.forEach((listener) => listener());
      });
    },
  };
}

/** Классы кита на узле: всё, что начинается с `tgui-`. Классы модуля в
 *  vitest отдаются своими именами, так что подмешивания не будет. */
function kitClasses(element: Element): string[] {
  return Array.from(element.classList).filter((name) => name.startsWith("tgui-"));
}

/** Эталонный класс, который кит добавляет при withoutAnimation. */
function withoutAnimationClass(): string {
  const plain = kitClasses(render(<Skeleton visible />).container.firstElementChild as Element);
  const still = kitClasses(
    render(<Skeleton visible withoutAnimation />).container.firstElementChild as Element,
  );
  const extra = still.filter((name) => !plain.includes(name));
  expect(extra).toHaveLength(1);
  const [only] = extra;
  if (!only) throw new Error("эталонный класс не найден");
  return only;
}

/** Корень скелетона кита: единственный узел с классами `tgui-*`. */
function skeletonRoot(container: HTMLElement): HTMLElement {
  const node = container.querySelector<HTMLElement>('[class*="tgui-"]');
  if (!node) throw new Error("не найден корень tgui Skeleton");
  return node;
}

const VARIANTS: ReadonlyArray<readonly [string, ReactNode]> = [
  ["TripCardSkeleton", <TripCardSkeleton key="trip" />],
  ["NotificationCardSkeleton", <NotificationCardSkeleton key="notif" />],
  ["ReviewCardSkeleton", <ReviewCardSkeleton key="review" />],
  ["ProfileBarSkeleton", <ProfileBarSkeleton key="profile" />],
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("F22 — скелетоны уважают prefers-reduced-motion", () => {
  it("эталон: withoutAnimation у кита добавляет ровно один класс", () => {
    // Сначала убеждаемся, что сам эталон осмыслен: без этого тест ниже
    // проверял бы несуществующий класс.
    expect(withoutAnimationClass()).toMatch(/^tgui-/);
  });

  it.each(VARIANTS)("%s: при reduce анимация выключена", (_name, node) => {
    stubMatchMedia(true);
    const still = withoutAnimationClass();

    const root = skeletonRoot(render(node).container);

    expect(kitClasses(root)).toContain(still);
  });

  it.each(VARIANTS)("%s: без reduce анимация остаётся (нет перелёта)", (_name, node) => {
    // Обе стороны обязательны: тест «только про reduce» проходит и на
    // коде, который выключает анимацию ВСЕГДА.
    stubMatchMedia(false);
    const still = withoutAnimationClass();

    const root = skeletonRoot(render(node).container);

    expect(kitClasses(root)).not.toContain(still);
  });

  it.each(VARIANTS)("%s: при reduce болванка остаётся на месте", (_name, node) => {
    // WCAG 2.3.3: убрать надо анимацию, а не сам признак загрузки.
    stubMatchMedia(true);

    const { container } = render(node);
    const root = skeletonRoot(container);

    // Скелетон отрисован и не пуст: слой-заглушка на месте.
    expect(root.childElementCount).toBeGreaterThan(0);
    expect(root.getAttribute("aria-hidden")).toBe("true");
  });

  it("смена настройки ОС на лету переключает проп", () => {
    const media = stubMatchMedia(false);
    const still = withoutAnimationClass();

    const { container } = render(<TripCardSkeleton />);
    expect(kitClasses(skeletonRoot(container))).not.toContain(still);

    media.set(true);
    expect(kitClasses(skeletonRoot(container))).toContain(still);

    media.set(false);
    expect(kitClasses(skeletonRoot(container))).not.toContain(still);
  });

  it("среда без matchMedia: анимация остаётся, рендер не падает", () => {
    // Старый WebView / окружение без matchMedia — гасить движение
    // «на всякий случай» нельзя, скелетон обязан остаться анимированным.
    const still = withoutAnimationClass();
    vi.stubGlobal("matchMedia", undefined);

    const { container } = render(<TripCardSkeleton />);
    expect(kitClasses(skeletonRoot(container))).not.toContain(still);
  });

  it("хук спрашивает ровно тот запрос, который гасит движение", () => {
    const media = stubMatchMedia(true);
    render(<TripCardSkeleton />);
    expect(media.queries()).toContain(REDUCE_MOTION_QUERY);
  });
});
