// @vitest-environment jsdom
// Клавиатурный контракт ui/Switcher в ветках, которых не видит SSR-пин:
// пустой список не должен глотать стрелку (preventDefault), а value вне
// options не должен давать NaN в арифметике стрелок.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

import { Switcher } from "@/ui/Switcher";

afterEach(cleanup);

const OPTIONS = [
  { value: "all", label: "Все" },
  { value: "today", label: "Сегодня" },
  { value: "tomorrow", label: "Завтра" },
] as const;

describe("ui/Switcher: клавиатура на краях", () => {
  it("пустой список: стрелка не перехватывается (нет preventDefault)", () => {
    const { container } = render(
      <AppRoot>
        <Switcher
          options={[]}
          value={"x" as never}
          onChange={() => {}}
          ariaLabel="Пусто"
          idPrefix="empty"
        />
      </AppRoot>,
    );
    const group = container.querySelector('[role="radiogroup"]')!;
    // Событие создаём руками, чтобы прочитать defaultPrevented: до фикса
    // `(NaN) % 0` давало NaN, `NaN < 0 === false` и стрелка уходила в
    // preventDefault впустую (клавиша молча проглатывалась).
    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      bubbles: true,
      cancelable: true,
    });
    fireEvent(group, event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("value вне options: стрелка выбирает первый пункт, а не NaN", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AppRoot>
        <Switcher
          options={OPTIONS}
          value={"missing" as never}
          onChange={onChange}
          ariaLabel="Дата"
          idPrefix="edge"
        />
      </AppRoot>,
    );
    const group = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(group, { key: "ArrowRight" });
    // index = 0 (fallback на первый) → следующий пункт "today".
    expect(onChange).toHaveBeenCalledWith("today");
  });

  it("валидный value: стрелка вправо переходит к следующему пункту", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AppRoot>
        <Switcher
          options={OPTIONS}
          value="all"
          onChange={onChange}
          ariaLabel="Дата"
          idPrefix="ok"
        />
      </AppRoot>,
    );
    const group = container.querySelector('[role="radiogroup"]')!;
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("today");
  });
});
