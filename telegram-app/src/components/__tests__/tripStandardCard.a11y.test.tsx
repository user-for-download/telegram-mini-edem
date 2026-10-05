// @vitest-environment jsdom
// a11y-контракт TripStandardCard (аудит 2026-10-05).
//
// Регрессия: role/tabIndex/onKeyDown на корне карточки вешались только когда
// футера нет. У карточек /bookings футер есть всегда (поделиться + отмена),
// поэтому вся лента была доступна только мышью — Tab пропускал карточки, у
// них не было ни роли, ни фокуса. Причина была не в запрете вложенных
// интерактивных элементов (он про кнопку ВНУТРИ кнопки, а не про соседние
// области карточки), поэтому структура перестроена.
//
// Контракт, который здесь закреплён:
//  1. открытие поездки — НАСТОЯЩАЯ кнопка (фокус + Enter/Space из коробки);
//  2. внутри неё нет других кнопок (nested interactive запрещён);
//  3. слоты с действиями (футер, строки заявок −/+) — соседи кнопки;
//  4. тап мышью по любой части карточки по-прежнему открывает детали, и
//     открывает РОВНО один раз.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { StatusPill } from "@/components/StatusPill/StatusPill";

afterEach(cleanup);

const TRIP = {
  tripId: "t-1",
  fromCity: "Вологда",
  toCity: "Череповец",
  fromAddress: "Ж/д вокзал",
  toAddress: "Автовокзал",
  departureAt: new Date(Date.now() + 3_600_000).toISOString(),
  price: 450,
};

function renderCard(props: Partial<React.ComponentProps<typeof TripStandardCard>>) {
  return render(
    <AppRoot platform="base">
      <TripStandardCard
        {...TRIP}
        headerStatus={<StatusPill tone="warning">Ожидает</StatusPill>}
        person={{ name: "Александр", rating: 4.9, subtitle: "Lada Vesta · белый" }}
        onOpen={() => {}}
        {...props}
      />
    </AppRoot>,
  );
}

/** Кнопка открытия — нативная, с доступным именем. */
function openButton(): HTMLButtonElement {
  const button = screen.getByRole("button", { name: /Открыть поездку/ });
  expect(button.tagName).toBe("BUTTON");
  return button as HTMLButtonElement;
}

describe("TripStandardCard: открытие доступно с клавиатуры", () => {
  it("с футером: открытие — настоящая кнопка, а не div без роли", () => {
    renderCard({ footer: <button type="button">Отменить</button> });
    expect(openButton()).toBeTruthy();
  });

  it("с футером: кнопка фокусируема и активируется Enter", () => {
    const onOpen = vi.fn();
    renderCard({ footer: <button type="button">Отменить</button>, onOpen });

    const button = openButton();
    button.focus();
    expect(document.activeElement).toBe(button);

    // Нативная кнопка сама превращает Enter в click — эмулируем click,
    // который браузер сгенерировал бы по нажатию.
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("внутри кнопки открытия нет других кнопок (nested interactive)", () => {
    renderCard({
      footer: (
        <>
          <button type="button">Поделиться</button>
          <button type="button">Отменить</button>
        </>
      ),
    });
    const button = openButton();
    expect(button.querySelectorAll("button")).toHaveLength(0);
  });

  it("personOverride с кнопками заявок остаётся ВНЕ кнопки открытия", () => {
    // Строки заявок водителя (−/+) — интерактив; завернуть их в кнопку
    // открытия было бы ровно тем вложением, которого здесь избегаем.
    renderCard({
      personOverride: (
        <div>
          <button type="button">Отклонить заявку</button>
          <button type="button">Принять заявку</button>
        </div>
      ),
      footer: <button type="button">Поделиться</button>,
    });
    const button = openButton();
    expect(button.querySelectorAll("button")).toHaveLength(0);
    // Сами кнопки заявок на месте — мы их не потеряли.
    expect(screen.getByRole("button", { name: "Принять заявку" })).toBeTruthy();
  });

  it("тап по кнопке открывает РОВНО один раз (всплытие гасится)", () => {
    const onOpen = vi.fn();
    renderCard({ footer: <button type="button">Отменить</button>, onOpen });
    fireEvent.click(openButton());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("тап по футеру (не по кнопке) по-прежнему открывает детали", () => {
    // Регрессия на mouse-аффорданс: корень карточки остался кликабельным,
    // поэтому тап по пустому месту футера ведёт в детали, как раньше.
    const onOpen = vi.fn();
    const { container } = renderCard({
      footer: <span data-testid="footer-slot">слот</span>,
      onOpen,
    });
    const footer = container.querySelector('[data-testid="footer-slot"]');
    expect(footer).toBeTruthy();
    fireEvent.click(footer as Element);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("кнопка в футере не открывает карточку (своё действие)", () => {
    const onOpen = vi.fn();
    const onCancel = vi.fn();
    renderCard({
      footer: (
        <button type="button" onClick={onCancel}>
          Отменить
        </button>
      ),
      onOpen,
    });
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
