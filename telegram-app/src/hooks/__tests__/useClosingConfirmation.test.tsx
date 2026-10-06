// @vitest-environment jsdom
// B11: closingBehavior — ГЛОБАЛЬНОЕ состояние клиента, а грязных форм
// может быть несколько одновременно (страница формы плюс шторка внутри
// неё). Прежняя реализация в cleanup всегда звала disableConfirmation,
// поэтому размонтирование одной снимало подтверждение у другой.
//
// Проверяем ИТОГОВОЕ состояние флага, а не число вызовов: React при
// смене типа в том же слое перемонтирует компонент (cleanup старого →
// effect нового), и корректная пара disable+enable не означает, что
// подтверждение выключалось для пользователя.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const { mockEnable, mockDisable, state } = vi.hoisted(() => ({
  mockEnable: vi.fn(),
  mockDisable: vi.fn(),
  state: { on: false },
}));

vi.mock("@tma.js/sdk-react", () => ({
  closingBehavior: {
    enableConfirmation: { ifAvailable: mockEnable },
    disableConfirmation: { ifAvailable: mockDisable },
  },
}));

import {
  resetClosingConfirmation,
  useClosingConfirmation,
} from "@/hooks/useClosingConfirmation";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(children: React.ReactNode) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root?.render(children);
  });
}

/** Стабильные ключи: перестановка детей не должна выглядеть как замена. */
function DirtyForm({ id }: { id: string }) {
  useClosingConfirmation(true);
  return <div data-testid={id} />;
}

beforeEach(() => {
  mockEnable.mockReset();
  mockDisable.mockReset();
  resetClosingConfirmation();
  state.on = false;
  mockEnable.mockImplementation(() => {
    state.on = true;
  });
  mockDisable.mockImplementation(() => {
    state.on = false;
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  resetClosingConfirmation();
  state.on = false;
});

describe("useClosingConfirmation: счётчик грязных форм (B11)", () => {
  it("happy: одна форма — подтверждение на маунте, снятие на размонтировании", () => {
    render(<DirtyForm id="a" key="a" />);
    expect(state.on).toBe(true);

    render(<div />);
    expect(state.on).toBe(false);
  });

  it("edge: уход одной из двух грязных форм НЕ снимает подтверждение", () => {
    render(
      <>
        <DirtyForm id="a" key="a" />
        <DirtyForm id="b" key="b" />
      </>,
    );
    expect(state.on).toBe(true);

    // Уходит первая форма — вторая всё ещё грязная.
    render(<DirtyForm id="b" key="b" />);
    expect(state.on).toBe(true);

    // Уходит и вторая — теперь можно гасить.
    render(<div />);
    expect(state.on).toBe(false);
  });

  it("edge: уход в середине не оставляет подтверждение включённым", () => {
    // Три грязные формы, уходят по одной.
    render(
      <>
        <DirtyForm id="a" key="a" />
        <DirtyForm id="b" key="b" />
        <DirtyForm id="c" key="c" />
      </>,
    );
    expect(state.on).toBe(true);

    render(
      <>
        <DirtyForm id="b" key="b" />
        <DirtyForm id="c" key="c" />
      </>,
    );
    expect(state.on).toBe(true);

    render(<DirtyForm id="c" key="c" />);
    expect(state.on).toBe(true);

    render(<div />);
    expect(state.on).toBe(false);
  });

  it("edge: форма стала чистой — подтверждение снимается", () => {
    function MaybeDirty({ dirty }: { dirty: boolean }) {
      useClosingConfirmation(dirty);
      return <div />;
    }

    render(<MaybeDirty dirty />);
    expect(state.on).toBe(true);

    render(<MaybeDirty dirty={false} />);
    expect(state.on).toBe(false);
  });

  it("edge: форма ожила после clean-состояния — подтверждение возвращается", () => {
    function MaybeDirty() {
      const [dirty, setDirty] = useState(true);
      useClosingConfirmation(dirty);
      return (
        <button type="button" onClick={() => setDirty((d) => !d)}>
          переключить
        </button>
      );
    }

    render(<MaybeDirty />);
    expect(state.on).toBe(true);

    act(() => {
      document.querySelector("button")?.click();
    });
    expect(state.on).toBe(false);

    act(() => {
      document.querySelector("button")?.click();
    });
    expect(state.on).toBe(true);
  });

  it("edge: подтверждение включается один раз на клиенте, а не на форму", () => {
    render(
      <>
        <DirtyForm id="a" key="a" />
        <DirtyForm id="b" key="b" />
        <DirtyForm id="c" key="c" />
      </>,
    );

    expect(state.on).toBe(true);
    expect(mockEnable).toHaveBeenCalledTimes(1);
  });
});
