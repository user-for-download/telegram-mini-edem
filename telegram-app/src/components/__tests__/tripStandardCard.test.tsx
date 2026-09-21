import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { StatusPill } from "@/components/StatusPill";

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
  it("шапка: дата — статус — цена; маршрут; персона; тап", () => {
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
    expect(html).toContain("Открыть поездку Вологда — Череповец");
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
});
