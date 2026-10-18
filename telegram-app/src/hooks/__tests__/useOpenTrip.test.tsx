// useOpenTrip: детали поездки открываются шторкой поверх ТЕКУЩЕГО экрана.
//
// Пин на state.backgroundLocation: без него роутер не знает, откуда пришли,
// и фоном всегда рисует «Поиск» (тап по уведомлению выглядел как «сначала
// перекинуло на другую вкладку, потом открылись детали»).
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { tripIdFromPath, useOpenTrip } from "@/hooks/useOpenTrip";

afterEach(cleanup);

function Probe() {
  const location = useLocation();
  const openTrip = useOpenTrip();
  return (
    <>
      <button type="button" onClick={() => openTrip("trip-1")}>
        open
      </button>
      <output data-testid="path">{location.pathname}</output>
      <output data-testid="background">
        {(
          location.state as { backgroundLocation?: { pathname: string } } | null
        )?.backgroundLocation?.pathname ?? ""}
      </output>
    </>
  );
}

describe("useOpenTrip: фон шторки — текущий экран", () => {
  it("несёт backgroundLocation и адрес деталей", () => {
    render(
      <MemoryRouter initialEntries={["/notifications"]}>
        <Probe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("path").textContent).toBe("/trips/trip-1");
    expect(screen.getByTestId("background").textContent).toBe("/notifications");
  });

  it("id экранируется в адресе", () => {
    function EscapingProbe() {
      const openTrip = useOpenTrip();
      const location = useLocation();
      return (
        <>
          <button type="button" onClick={() => openTrip("a/b")}>
            open
          </button>
          <output data-testid="path">{location.pathname}</output>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={["/"]}>
        <EscapingProbe />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("path").textContent).toBe("/trips/a%2Fb");
    // И обратно: такой адрес остаётся деталями поездки с тем же id.
    expect(tripIdFromPath("/trips/a%2Fb")).toBe("a/b");
  });
});

describe("tripIdFromPath: что считается деталями поездки", () => {
  it("детали — только /trips/<id>", () => {
    expect(tripIdFromPath("/trips/t-1")).toBe("t-1");
    expect(tripIdFromPath("/trips/t-1/")).toBe("t-1");
    expect(tripIdFromPath("/trips/t-1?x=1")).toBe("t-1");
    expect(tripIdFromPath("/trips/0a329014-633e-5dab-ab86-e6a3ad77be8b")).toBe(
      "0a329014-633e-5dab-ab86-e6a3ad77be8b",
    );
  });

  it("разделы и другие экраны — не детали", () => {
    expect(tripIdFromPath("/trips")).toBeNull();
    expect(tripIdFromPath("/trips/my")).toBeNull();
    expect(tripIdFromPath("/trips/my/new")).toBeNull();
    expect(tripIdFromPath("/trips/my/t-1/requests")).toBeNull();
    expect(tripIdFromPath("/bookings")).toBeNull();
    expect(tripIdFromPath("/notifications")).toBeNull();
    expect(tripIdFromPath("/reviews")).toBeNull();
  });
});
