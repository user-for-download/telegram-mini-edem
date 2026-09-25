// Тесты U1: QueryState/Skeletons/MutationError — тонкие обёртки над
// ui-китом (EmptyState/Notice), без дублей разметки.
// Паттерн ui/__tests__/notice.test.tsx (SSR renderToString, без
// testing-library): проверяются только обёртки — ветвление QueryState,
// тексты/слоты error+empty, a11y-объявления скелетонов, контракт
// MutationError. Внутренности tgui Placeholder/Skeleton не тестируем.
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { QueryState } from "@/components/QueryState";
import { MutationError } from "@/components/MutationError";
import {
  NotificationCardSkeleton,
  NotificationCardsSkeleton,
  ReviewCardSkeleton,
  ReviewCardsSkeleton,
  TripCardSkeleton,
  TripCardsSkeleton,
} from "@/components/Skeletons";

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    loading: false,
    error: null,
    empty: false,
    emptyText: "",
    onRetry: vi.fn(),
    children: "Контент",
    ...overrides,
  };
}

/** tgui Button/Placeholder читают контекст AppRoot (как в SearchPage.test). */
function render(element: ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

function statusCount(html: string): number {
  return html.match(/role="status"/g)?.length ?? 0;
}

describe("QueryState", () => {
  it("loading со скелетоном: рендерит скелетон, контент скрыт", () => {
    const html = render(
      <QueryState {...baseProps({ loading: true, skeleton: <TripCardsSkeleton /> })} />,
    );
    expect(html).toContain('aria-label="Загрузка"');
    expect(html).not.toContain("Контент");
  });

  it("loading без скелетона: спиннер с role=status", () => {
    const html = render(
      <QueryState {...baseProps({ loading: true })} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Загрузка"');
    expect(html).not.toContain("Контент");
  });

  it("error: EmptyState с retry, контент скрыт", () => {
    const html = render(
      <QueryState {...baseProps({ error: new Error("boom") })} />,
    );
    expect(html).toContain("Не удалось загрузить данные");
    expect(html).toContain("Проверьте соединение и повторите попытку.");
    expect(html).toContain("Повторить");
    expect(html).not.toContain("Контент");
  });

  it("empty: EmptyState с emptyText и emptyAction", () => {
    const html = render(
      <QueryState
        {...baseProps({
          empty: true,
          emptyText: "Здесь появятся поездки.",
          emptyAction: "Действие",
        })}
      />,
    );
    expect(html).toContain("Пока пусто");
    expect(html).toContain("Здесь появятся поездки.");
    expect(html).toContain("Действие");
    expect(html).not.toContain("Контент");
  });

  it("контент: дети без состояний", () => {
    const html = render(<QueryState {...baseProps()} />);
    expect(html).toContain("Контент");
    expect(html).not.toContain("Пока пусто");
    expect(html).not.toContain("Не удалось загрузить данные");
  });

  it("приоритет: loading выше error, error выше empty", () => {
    const loadingWins = render(
      <QueryState
        {...baseProps({ loading: true, error: new Error("x"), empty: true, emptyText: "пусто" })}
      />,
    );
    expect(loadingWins).not.toContain("Не удалось загрузить данные");
    expect(loadingWins).not.toContain("Пока пусто");

    const errorWins = render(
      <QueryState
        {...baseProps({ error: new Error("x"), empty: true, emptyText: "пусто" })}
      />,
    );
    expect(errorWins).toContain("Не удалось загрузить данные");
    expect(errorWins).not.toContain("Пока пусто");
  });
});

describe("Skeletons", () => {
  it("списки объявляются один раз (single role=status)", () => {
    expect(statusCount(render(<TripCardsSkeleton />))).toBe(1);
    expect(statusCount(render(<NotificationCardsSkeleton />))).toBe(1);
    expect(statusCount(render(<ReviewCardsSkeleton />))).toBe(1);
  });

  it("count задаёт число болванок (по умолчанию 3)", () => {
    // Маркер на болванку: уникальный класс первой строки каждой карточки.
    const tripDefault = render(<TripCardsSkeleton />);
    expect(tripDefault.match(/h-4 w-28/g)?.length).toBe(3);
    const tripTwo = render(<TripCardsSkeleton count={2} />);
    expect(tripTwo.match(/h-4 w-28/g)?.length).toBe(2);

    const notif = render(<NotificationCardsSkeleton count={2} />);
    expect(notif.match(/h-4 w-2\/5/g)?.length).toBe(2);

    const reviews = render(<ReviewCardsSkeleton count={1} />);
    expect(reviews.match(/h-7 w-7/g)?.length).toBe(1);
  });

  it("одиночные болванки без собственного role=status (их объявляет родитель)", () => {
    // QueryState skeleton — через SkeletonStack, FetchMore placeholder —
    // через свой role=status-контейнер: двойных объявлений быть не должно.
    expect(statusCount(render(<TripCardSkeleton />))).toBe(0);
    expect(statusCount(render(<NotificationCardSkeleton />))).toBe(0);
    expect(statusCount(render(<ReviewCardSkeleton />))).toBe(0);
  });
});

describe("MutationError", () => {
  it("без ошибки — пустой рендер", () => {
    // Без AppRoot-обёртки: сам компонент возвращает null (охват точный).
    expect(renderToString(<MutationError error={null} />)).toBe("");
    expect(renderToString(<MutationError error={undefined} />)).toBe("");
  });

  it("Error — текст сообщения через Notice", () => {
    const html = render(
      <MutationError error={new Error("Сеть недоступна")} />,
    );
    expect(html).toContain("Сеть недоступна");
    expect(html).toContain('role="alert"');
  });

  it("не-Error — fallback без дубля словаря", () => {
    const html = render(<MutationError error="строка" />);
    expect(html).toContain("Не удалось выполнить действие");
  });
});
