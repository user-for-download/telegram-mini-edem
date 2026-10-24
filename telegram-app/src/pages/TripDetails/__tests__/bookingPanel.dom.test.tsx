// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Trip } from "@edem/contracts";
import type { ComponentProps } from "react";
import { BookingBar, BookingPanel } from "../BookingPanel";

vi.mock("@/queries/useBookingsQuery", () => ({
  useCancelBookingMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

afterEach(cleanup);

const trip = {
  price: 500,
  seatsTotal: 3,
  seatsAvailable: 2,
  myBooking: null,
} as Trip;

const createBooking = {
  isPending: false,
  error: null,
} as ComponentProps<typeof BookingPanel>["createBooking"];

function Form({ onSelectSeat }: { onSelectSeat: (seat: number) => void }) {
  const [comment, setComment] = useState("");
  return (
    <AppRoot platform="base">
      <BookingPanel
        item={trip}
        isDriver={false}
        isActive
        departed={false}
        hasActiveBooking={false}
        canBook
        effectiveSeat={1}
        takenSeats={[2]}
        comment={comment}
        createBooking={createBooking}
        onSelectSeat={onSelectSeat}
        onCommentChange={setComment}
      />
    </AppRoot>
  );
}

describe("BookingPanel", () => {
  it("раскрывает поле и сохраняет введённый комментарий при сворачивании", () => {
    render(<Form onSelectSeat={vi.fn()} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    const toggle = screen.getByRole("button", {
      name: "Добавить комментарий водителю",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panelId = toggle.getAttribute("aria-controls")!;

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(panelId)?.hidden).toBe(false);
    fireEvent.change(screen.getByRole("textbox", { name: "Комментарий водителю" }), {
      target: { value: "Буду с чемоданом" },
    });

    fireEvent.click(toggle);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(toggle);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(
      "Буду с чемоданом",
    );
  });

  it("выбирает свободное место, а занятое остаётся недоступным", () => {
    const onSelectSeat = vi.fn();
    render(<Form onSelectSeat={onSelectSeat} />);
    expect((screen.getByRole("button", { name: "Место 2 занято" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Место 1 выбрано" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Выбрать место 3" }));
    expect(onSelectSeat).toHaveBeenCalledWith(3);
  });
});

describe("BookingBar", () => {
  it.each([null, 1])("блокирует повторную отправку при pending (место %s)", (seat) => {
    const onSubmit = vi.fn();
    render(
      <AppRoot platform="base">
        <BookingBar
          item={trip}
          canBook
          effectiveSeat={seat}
          createBooking={
            { isPending: true, error: null } as typeof createBooking
          }
          onSubmit={onSubmit}
        />
      </AppRoot>,
    );
    const button = screen.getByRole("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
