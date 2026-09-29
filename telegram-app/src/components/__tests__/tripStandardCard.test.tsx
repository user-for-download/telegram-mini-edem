import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { StatusPill } from "@/components/StatusPill/StatusPill";

function render(element: ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

const TRIP = {
  tripId: "t-1",
  fromCity: "Вологда",
  toCity: "Череповец",
  fromAddress: "Ж/д вокзал",
  toAddress: "Автовокзал",
  departureAt: new Date(Date.now() + 3_600_000).toISOString(),
  price: 450,
};

describe("TripStandardCard", () => {
  it("шапка: дата — статус — цена; маршрут; персона; действия", () => {
    const onOpen = vi.fn();
    const html = render(
      <TripStandardCard
        {...TRIP}
        headerStatus={<StatusPill tone="warning">Ожидает</StatusPill>}
        person={{
          name: "Александр",
          rating: 4.9,
          subtitle: "Lada Vesta · белый · место №1",
          showCarIcon: true,
        }}
        footer={<button type="button">Детали поездки</button>}
        onOpen={onOpen}
      />,
    );
    // Карточка — не role=button (внутри свои кнопки): открытие —
    // через явную кнопку действий в футере.
    expect(html).not.toContain('role="button"');
    expect(html).toContain("Ожидает");
    expect(html).toContain("450");
    expect(html).toContain("Вологда");
    expect(html).toContain("Череповец");
    expect(html).toContain("Ж/д вокзал");
    expect(html).toContain("Автовокзал");
    expect(html).toContain("Александр");
    expect(html).toContain("4.9");
    expect(html).toContain("Lada Vesta · белый · место №1");
    expect(html).toContain("Детали поездки");
  });

  it("без цены и рейтинга — ничего не ломается", () => {
    const html = render(
      <TripStandardCard
        {...TRIP}
        price={null}
        departureAt={null}
        headerStatus={<StatusPill tone="success">Активна</StatusPill>}
        person={{ name: "Вы водитель", subtitle: "Свободно 3 из 3" }}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("Вы водитель");
    expect(html).toContain("Свободно 3 из 3");
    expect(html).toContain("Активна");
    expect(html).not.toContain("undefined");
  });

  it("passengers заданы — вместо рейтинга аватарстак с «+N»", () => {
    const html = render(
      <TripStandardCard
        {...TRIP}
        headerStatus={<StatusPill tone="info">Свободно 1</StatusPill>}
        person={{
          name: "Вы водитель",
          subtitle: "Пассажиры: 4",
          passengers: [
            { id: "p1", name: "Иван", avatar: "https://t.me/1.png" },
            { id: "p2", name: "Пётр", avatar: "https://t.me/2.png" },
            { id: "p3", name: "Анна", avatar: "https://t.me/3.png" },
            { id: "p4", name: "Олег", avatar: "https://t.me/4.png" },
          ],
        }}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("Пассажиры: Иван, Пётр, Анна, Олег");
    expect(html).toContain("+1");
    expect(html).not.toContain("Рейтинг");
  });

  it("passengers пустой — рейтинг не подставляется вместо стека", () => {
    const html = render(
      <TripStandardCard
        {...TRIP}
        headerStatus={<StatusPill tone="info">Свободно 1</StatusPill>}
        person={{ name: "Вы водитель", subtitle: "Пассажиры: 0", passengers: [] }}
        onOpen={() => {}}
      />,
    );
    expect(html).not.toContain('aria-label="Пассажиры:');
    expect(html).not.toContain("Рейтинг");
  });
});
