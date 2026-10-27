// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { updateTripDtoSchema, type Trip } from "@edem/contracts";
import { EditTripForm } from "../EditTripForm";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock("@/queries/useTripsQuery", () => ({
  useUpdateTripMutation: () => ({ mutate, isPending: false, error: null }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function show(durationMinutes = 110) {
  const trip = {
    id: "t-edit",
    fromAddress: "Вокзал",
    toAddress: "Автовокзал",
    departureAt: "2030-06-01T06:00:00.000Z",
    durationMinutes,
    distanceKm: 155,
    price: 700,
    seatsTotal: 3,
    tags: [],
    comment: "Еду без остановок",
  } as unknown as Trip;
  render(
    <AppRoot platform="base">
      <EditTripForm trip={trip} onDone={vi.fn()} />
    </AppRoot>,
  );
}

describe("EditTripForm: сохранение комментария и точной длительности", () => {
  it("очистка комментария отправляет пустую строку, не пропускает поле", () => {
    show();
    fireEvent.change(screen.getByRole("textbox", { name: "Комментарий пассажирам" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ comment: "" }) }),
      expect.any(Object),
    );
  });

  it.each([15, 110, 125])("показывает и сохраняет %s минут без округления", (minutes) => {
    show(minutes);
    const input = screen.getByRole("spinbutton", { name: "В пути, минут" }) as HTMLInputElement;
    expect(input.value).toBe(String(minutes));
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationMinutes: minutes }) }),
      expect.any(Object),
    );
  });

  it("правка и возврат длительности сохраняют исходные минуты", () => {
    show(110);
    const input = screen.getByRole("spinbutton", { name: "В пути, минут" });
    fireEvent.change(input, { target: { value: "120" } });
    fireEvent.change(input, { target: { value: "110" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ durationMinutes: 110 }) }),
      expect.any(Object),
    );
  });

  it.each(["0", "10081", "1.5"])("отвергает длительность %s за границами DTO", (value) => {
    show();
    fireEvent.change(screen.getByRole("spinbutton", { name: "В пути, минут" }), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText("Время в пути — от 1 минуты до 7 суток")).toBeTruthy();
  });

  it("контракт различает отсутствующий и очищенный комментарий", () => {
    expect(updateTripDtoSchema.parse({})).not.toHaveProperty("comment");
    expect(updateTripDtoSchema.parse({ comment: "" })).toHaveProperty("comment", "");
  });
});
