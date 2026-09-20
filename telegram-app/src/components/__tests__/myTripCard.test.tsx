import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MyTripCard } from "@/components/Section/MyTripCard";

function render(node: React.ReactElement): string {
  return renderToStaticMarkup(<AppRoot>{node}</AppRoot>);
}

const TRIP = {
  id: "t-1",
  fromCity: "Вологда",
  toCity: "Череповец",
  fromAddress: "пл. Бабушкина, 1",
  toAddress: "пр. Победы, 10",
  departureAt: "2030-06-01T09:00:00.000Z",
  time: "09:00",
  price: 450,
  driver: {
    name: "Александр",
    rating: 4.8,
    car: { model: "Lada Vesta", color: "белый" },
  },
};

describe("MyTripCard", () => {
  it("шапка: дата — статус — цена", () => {
    const html = render(
      <MyTripCard seat={2} status="confirmed" trip={TRIP} onOpen={() => {}} />,
    );
    expect(html).toContain("Бронь №2");
    expect(html).toContain("450");
    expect(html).toContain("июн");
  });

  it("pending: «Ожидает», места посадки скрыты", () => {
    const html = render(
      <MyTripCard seat={1} status="pending" trip={TRIP} onOpen={() => {}} />,
    );
    expect(html).toContain("Ожидает");
    expect(html).not.toContain("пл. Бабушкина");
    expect(html).not.toContain("пр. Победы");
  });

  it("confirmed: места посадки видны", () => {
    const html = render(
      <MyTripCard seat={2} status="confirmed" trip={TRIP} onOpen={() => {}} />,
    );
    expect(html).toContain("пл. Бабушкина");
    expect(html).toContain("пр. Победы");
  });

  it("водитель: имя, машина и цвет, рейтинг", () => {
    const html = render(
      <MyTripCard seat={2} status="confirmed" trip={TRIP} onOpen={() => {}} />,
    );
    expect(html).toContain("Александр");
    expect(html).toContain("Lada Vesta · белый");
    expect(html).toContain("4.8");
  });

  it("без машины — «Водитель»", () => {
    const html = render(
      <MyTripCard
        seat={2}
        status="confirmed"
        trip={{ ...TRIP, driver: { name: "Александр" } }}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain("Водитель");
  });

  it("карточка — кнопка с подписью поездки", () => {
    const onOpen = vi.fn();
    const html = render(
      <MyTripCard seat={2} status="confirmed" trip={TRIP} onOpen={onOpen} />,
    );
    expect(html).toContain('role="button"');
    expect(html).toContain("Открыть поездку Вологда — Череповец");
    expect(onOpen).not.toHaveBeenCalled();
  });
});
