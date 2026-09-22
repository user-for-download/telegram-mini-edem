// @vitest-environment jsdom
// Тесты RatingInput (обёртка над tgui Rating): поведение обёртки, не internals tgui.
// Паттерн SSR-тестов репозитория расширен до jsdom — клики/фокус требуют DOM,
// @testing-library в зависимостях нет, поэтому ручной root + act из React 19.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppRoot } from "@telegram-apps/telegram-ui";

vi.mock("@/utils/haptics", () => ({
  haptic: { selection: vi.fn() },
}));

import { haptic } from "@/utils/haptics";
import { RatingInput } from "@/components/RatingInput/RatingInput";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderInput(value: number, onChange: (v: number) => void): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <AppRoot platform="base">
        <span id="review-rating-label">Оценка</span>
        <RatingInput value={value} onChange={onChange} />
      </AppRoot>,
    );
  });
  return container;
}

/** Звёздные radio tgui Rating (value "1.0"–"5.0"); служебный value="0" — мимо. */
function starInputs(scope: HTMLElement): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
    (input) => input.value !== "0",
  );
}

/** Сколько звёзд активно (data-active=true — CSS заливает их --app-rating). */
function pickedCount(scope: HTMLElement): number {
  return [...scope.querySelectorAll("svg")].filter(
    (svg) => svg.getAttribute("data-active") === "true",
  ).length;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

describe("RatingInput", () => {
  it("happy: клик по третьей звезде — onChange(3) + haptic.selection", () => {
    const onChange = vi.fn();
    const scope = renderInput(5, onChange);

        const third = starInputs(scope).find((input) => input.value === "3");
    expect(third).toBeDefined();
    act(() => {
      third?.click();
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
    expect(haptic.selection).toHaveBeenCalledTimes(1);
  });

  it("happy: value отрисовывает текущий рейтинг", () => {
    const scope = renderInput(2, () => {});

    expect(starInputs(scope)).toHaveLength(5);
    expect(pickedCount(scope)).toBe(2);
  });

  it("edge: программный сброс value (setRating(5) после отправки) — repaint через remount", () => {
    // Родительское состояние как в ReviewsBody: клик → setRating, reset → setRating(5).
    function Harness() {
      const [value, setValue] = useState(5);
      return (
        <AppRoot platform="base">
          <span id="review-rating-label">Оценка</span>
          <RatingInput value={value} onChange={setValue} />
          <button type="button" data-testid="reset" onClick={() => setValue(5)}>
            reset
          </button>
        </AppRoot>
      );
    }
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Harness />);
    });
    const scope = container;
        const second = starInputs(scope).find((input) => input.value === "2");
    act(() => {
      second?.click();
    });
    expect(pickedCount(scope)).toBe(2);

    // tgui Rating сеет внутреннее состояние один раз — обёртка
    // перемонтирует его через key, визуал возвращается к 5.
    const reset = scope.querySelector<HTMLButtonElement>('button[data-testid="reset"]');
    act(() => {
      reset?.click();
    });
    expect(pickedCount(scope)).toBe(5);
  });

  it("a11y: radiogroup именована review-rating-label, звёзды доступны с клавиатуры", () => {
    const scope = renderInput(5, () => {});

    const group = scope.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-labelledby")).toBe("review-rating-label");
    expect(scope.querySelector("#review-rating-label")?.textContent).toBe("Оценка");

    const stars = starInputs(scope);
    expect(stars).toHaveLength(5);
    // Нативные radio одного name: Tab-достижимы, стрелки — из коробки браузера.
    const names = new Set(stars.map((input) => input.name));
    expect(names.size).toBe(1);
    for (const star of stars) {
      expect(star.disabled).toBe(false);
      expect(star.tabIndex).toBeGreaterThanOrEqual(0);
    }
    act(() => {
      stars[0]?.focus();
    });
    expect(document.activeElement).toBe(stars[0]);
  });
});
