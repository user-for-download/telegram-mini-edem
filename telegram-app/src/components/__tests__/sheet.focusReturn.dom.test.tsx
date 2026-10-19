// @vitest-environment jsdom
// F7 + F23 — ui/Sheet: возврат фокуса на триггер и вложенные шторки.
//
// F7. Sheet ничего не передавал киту в `trigger`, поэтому `Drawer.Trigger`
// не рендерился, `context.triggerRef.current` оставался `null`, а ветка
// Radix `context.triggerRef.current?.focus()` (@radix-ui/react-dialog:
//154-157) была no-op — но ставила `preventDefault()`, глуша единственный
// откат FocusScope (@radix-ui/react-focus-scope:98-100). На старом коде
// после open→close `document.activeElement === document.body`.
//
// F23. ConfirmPopup внутри открытой шторки рисовал ВТОРОЙ `Drawer.Root`
// поверх уже открытого `Drawer.Content`: своя блокировка скролла, своя
// анимация, свой корень. Кит для такого случая даёт `Drawer.NestedRoot`
// (Modal `nested`), и `ui/Sheet` его не поднимал.
//
// Тайминги в тесте не выдуманы: `closeDrawer` у vaul снимает `isOpen`
// через `setTimeout(..., 300)` (vaul-with-scroll-fix/dist/index.mjs), а
// возврат фокуса приходит из cleanup FocusScope ещё через `setTimeout(0)`
// — поэтому закрытие ждём через `waitFor`, а не «как-нибудь».
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { useState } from "react";
import { Sheet } from "@/ui/Sheet";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { handleModalBack, useModalBack } from "@/utils/modalBack";

// usePlatform читает внутренний контекст кита (см. sheet.test.tsx).
vi.mock("@/hooks/usePlatform", () => ({ usePlatform: () => "base" }));

// Обязателен: Modal — портал на Radix-примитивах, и незакрытая шторка
// держит на document focusin-ловушку FocusScope.
afterEach(cleanup);

/** Диалоги-шторки, которые сейчас смонтированы. */
const drawers = () =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"][vaul-drawer]')];

/** Внешняя (не вложенная) шторка: единственная, если вложенных нет. */
const outerDrawer = () => drawers().find((d) => !d.hasAttribute("data-aria-hidden"));

/** Ждём, пока ваул действительно размонтирует закрытую шторку. */
const waitClosed = (count: number) =>
  waitFor(() => expect(drawers()).toHaveLength(count), {
    timeout: 3000,
    interval: 50,
  });

/** Хост-шторка: кнопка-триггер снаружи, закрытие — кнопкой внутри. */
function SheetHost() {
  const [open, setOpen] = useState(false);
  useModalBack(() => setOpen(false), open);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Открыть шторку
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Автомобиль">
        <button type="button" onClick={() => setOpen(false)}>
          Закрыть шторку
        </button>
      </Sheet>
    </>
  );
}

describe("F7: фокус после закрытия шторки", () => {
  it("возвращается на элемент, который открыл шторку, а не на BODY", async () => {
    // Триггер снимаем ДО открытия — на старом коде здесь был BODY, и
    // сравнение «focus не на body» прошло бы вхолостую.
    render(
      <AppRoot platform="base">
        <SheetHost />
      </AppRoot>,
    );
    const trigger = screen.getByRole("button", { name: "Открыть шторку" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    // При открытии фокус уходит В шторку (точка входа для клавиатуры).
    const inside = document.activeElement as HTMLElement;
    expect(inside).not.toBe(trigger);
    expect(inside.closest('[role="dialog"][vaul-drawer]')).not.toBeNull();
    expect(inside.textContent).toContain("Закрыть шторку");

    fireEvent.click(screen.getByRole("button", { name: "Закрыть шторку" }));
    await waitClosed(0);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("Esc закрывает шторку и тоже возвращает фокус (Esc-регресс)", async () => {
    // Возврат фокуса нельзя чинить ценой Esc: тот же путь закрытия
    // (`onOpenChange(false)` → `onClose`), но инициирован DismissableLayer.
    render(
      <AppRoot platform="base">
        <SheetHost />
      </AppRoot>,
    );
    const trigger = screen.getByRole("button", { name: "Открыть шторку" });
    trigger.focus();
    fireEvent.click(trigger);
    const inside = document.activeElement as HTMLElement;

    fireEvent.keyDown(inside, { key: "Escape" });
    await waitClosed(0);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("подтверждение возвращает фокус на свою кнопку ВНУТРИ шторки", async () => {
    // Вложенный случай: элемент-открыватель лежит в теле внешней шторки.
    // Возврат наружу (на кнопку, открывшую «Автомобиль») уводил бы
    // клавиатуру из-под открытой шторки.
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet open={open} onClose={() => setOpen(false)} title="Автомобиль">
          <ConfirmPopup
            nested
            label="Удалить автомобиль"
            confirmLabel="Да, удалить"
            description="Автомобиль будет удалён из профиля."
            onConfirm={() => {}}
          />
        </Sheet>
      );
    }
    render(
      <AppRoot platform="base">
        <Host />
      </AppRoot>,
    );

    const trigger = screen.getByRole("button", { name: "Удалить автомобиль" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Да, удалить" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    await waitClosed(1);

    await waitFor(() => expect(document.activeElement).toBe(trigger));
    // Внешняя шторка осталась открытой и фокус внутри её.
    expect(trigger.closest('[role="dialog"][vaul-drawer]')).not.toBeNull();
  });
});

describe("F7: стек Back не должен пострадать от возврата фокуса", () => {
  it("Back закрывает подтверждение первым, внешнюю шторку — вторым (LIFO)", async () => {
    // MEMORY.md §18 — Back-хендлеры работают по LIFO. Возврат фокуса
    // не должен ни подписаться на Back, ни переставить подписки.
    function Host() {
      const [open, setOpen] = useState(true);
      useModalBack(() => setOpen(false), open);
      return (
        <Sheet open={open} onClose={() => setOpen(false)} title="Автомобиль">
          <ConfirmPopup
            nested
            label="Удалить автомобиль"
            confirmLabel="Да, удалить"
            description="Автомобиль будет удалён из профиля."
            onConfirm={() => {}}
          />
        </Sheet>
      );
    }
    render(
      <AppRoot platform="base">
        <Host />
      </AppRoot>,
    );

    const trigger = screen.getByRole("button", { name: "Удалить автомобиль" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(drawers()).toHaveLength(2);

    // Верх стека — подтверждение, а не внешняя шторка.
    await act(async () => {
      expect(handleModalBack()).toBe(true);
    });
    await waitClosed(1);
    expect(screen.queryByRole("dialog", { name: "Да, удалить" })).toBeNull();

    // И только теперь Back достаёт до внешней шторки.
    await act(async () => {
      expect(handleModalBack()).toBe(true);
    });
    await waitClosed(0);

    // Стек пуст — Back свободен экрану.
    await act(async () => {});
    expect(handleModalBack()).toBe(false);
  });
});

describe("F23: подтверждение поверх шторки — вложенный корень", () => {
  it("NestedRoot сдвигает внешнюю шторку (DOM-след onNestedOpenChange)", async () => {
    // Признак именно NestedRoot, а не второго Root: `NestedRoot` заводит
    // `onOpenChange` через `onNestedOpenChange` родителя
    // (vaul:1403-1426), и та пишет в inline-стиль внешнего
    // `[vaul-drawer]` `scale(...) translate3d(0, -16px, 0)`
    // (NESTED_DISPLACEMENT = 16, vaul:1207-1225). У обычного Root
    // этой записи нет.
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet open={open} onClose={() => setOpen(false)} title="Автомобиль">
          <ConfirmPopup
            nested
            label="Удалить автомобиль"
            confirmLabel="Да, удалить"
            description="Автомобиль будет удалён из профиля."
            onConfirm={() => {}}
          />
        </Sheet>
      );
    }
    render(
      <AppRoot platform="base">
        <Host />
      </AppRoot>,
    );

    const outer = outerDrawer() as HTMLElement;
    expect(outer.getAttribute("style") ?? "").not.toContain("translate3d");

    fireEvent.click(screen.getByRole("button", { name: "Удалить автомобиль" }));
    expect(drawers()).toHaveLength(2);

    await waitFor(() =>
      expect(outer.getAttribute("style") ?? "").toContain(
        "translate3d(0, -16px, 0)",
      ),
    );
    expect(outer.getAttribute("style")).toContain("scale(");
  });

  it("без nested вложенного сдвига нет — флаг решает, а не само место", async () => {
    // Тот же хост без `nested`: показываем, что проверка выше не проходит
    // вхолостую (это и есть «до фикса» в чистом виде).
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <Sheet open={open} onClose={() => setOpen(false)} title="Автомобиль">
          <ConfirmPopup
            label="Удалить автомобиль"
            confirmLabel="Да, удалить"
            description="Автомобиль будет удалён из профиля."
            onConfirm={() => {}}
          />
        </Sheet>
      );
    }
    render(
      <AppRoot platform="base">
        <Host />
      </AppRoot>,
    );
    const outer = outerDrawer() as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: "Удалить автомобиль" }));

    await waitFor(() => expect(drawers()).toHaveLength(2));
    expect(outer.getAttribute("style") ?? "").not.toContain("translate3d");
  });

  it("подтверждение на странице остаётся обычным корнем", async () => {
    // Вложенным может быть только то, что нарисовано В шторке: пять
    // ConfirmPopup на страницах (ProfilePage, DriverPanel ×2, TripCard ×2,
    // BookingPanel, RideRequestsList) живут вне Drawer.Content, и для них
    // NestedRoot взял бы контекст-заглушку.
    render(
      <AppRoot platform="base">
        <ConfirmPopup
          label="Удалить профиль"
          confirmLabel="Да, удалить профиль"
          description="Аккаунт будет анонимизирован."
          onConfirm={() => {}}
        />
      </AppRoot>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Удалить профиль" }));

    const dialog = screen.getByRole("dialog", { name: "Да, удалить профиль" });
    expect(dialog.closest('[vaul-drawer]')).not.toBeNull();
    // Родительского драуера нет: на странице открыт РОВНО один drawer —
    // сам confirm. Проверяем счётом, а не через outerDrawer(): тот ищет
    // первый диалог без data-aria-hidden, и в однооконном случае это
    // неизбежно сам confirm, поэтому проверка была бы бессмысленной.
    expect(drawers()).toHaveLength(1);
    // ...и у него нет inline-сдвига вложенности (scale/translate3d).
    expect(dialog.getAttribute("style") ?? "").not.toContain("translate3d");
  });
});

describe("F23: флаг nested стоит ровно на ConfirmPopup внутри шторки", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const readSrc = (relative: string): string =>
    readFileSync(join(here, "..", "..", relative), "utf8");

  /** JSX-вызовы компонента: от `<Name` до закрывающего `/>`. */
  const jsxUsages = (source: string, name: string): string[] =>
    source
      .split(`<${name}`)
      .slice(1)
      .map((chunk) => chunk.slice(0, chunk.indexOf("/>")));

  const cases: Array<{ file: string; count: number }> = [
    // Содержимое шторок: удаление машины и приём/отклонение заявки.
    { file: "components/Profile/VehicleModal.tsx", count: 1 },
    { file: "components/Trip/TripRequestsModal.tsx", count: 2 },
  ];
  for (const { file, count } of cases) {
    it(`${file}: все ${count} ConfirmPopup помечены nested`, () => {
      const usages = jsxUsages(readSrc(file), "ConfirmPopup");
      expect(usages).toHaveLength(count);
      for (const usage of usages) {
        expect(usage).toContain("nested");
      }
    });
  }

  const flat: string[] = [
    "components/Trip/TripCard.tsx",
    "components/Trip/RideRequestsList.tsx",
    "pages/TripDetails/BookingPanel.tsx",
    "pages/TripDetails/DriverPanel.tsx",
    "pages/Profile/ProfilePage.tsx",
  ];
  for (const file of flat) {
    it(`${file}: ConfirmPopup на странице БЕЗ nested`, () => {
      for (const usage of jsxUsages(readSrc(file), "ConfirmPopup")) {
        expect(usage).not.toContain("nested");
      }
    });
  }
});
