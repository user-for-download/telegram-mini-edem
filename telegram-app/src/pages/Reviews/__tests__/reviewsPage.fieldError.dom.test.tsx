// @vitest-environment jsdom
// Регресс F16: ошибка формы отзыва привязывается к тому контролу, о котором
// она говорит. Раньше сообщение лежало одной строкой (`formError`), а у
// textarea стояли руками `aria-invalid={Boolean(formError)}` и `status`:
// «Выберите поездку» (проблема ВЫБОРА поездки) красила кольцо вокруг поля
// комментария, а сама плашка `Notice` не имела id и не была связана ни с
// одним контролом — при фокусе скринридер не произносил ни слова
// (MEMORY.md §18: ошибка поля связывается FieldError через id +
// aria-describedby; несвязанная ошибка читается глазом, но на фокус не выходит).
//
// Проверяем ДЕРЕВО ДОСТУПНОСТИ, а не пропы: контролы ищем по роли и
// вычисленному доступному имени (label рисует ui/Field), а описание раскрываем
// через aria-describedby в текст узла — ровно то, что делает
// dom-accessibility-api. Проверка «статус-строка равна error» такой случай
// пропустила бы: кольцо на textarea и на <Select> выглядят одинаково.
//
// Отдельно проверяется вторая половина дефекта — ошибка, которая НЕ
// принадлежит полю (ответ сервера, ALREADY_REVIEWED), не должна помечать ни
// один контрол: раньше она тоже красила кольцо на комментарии.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { REVIEW_TEXT_MAX_LENGTH } from "@edem/contracts";

const {
  mockUseMyReviews,
  mockUseAvailableTrips,
  mockUseInfinite,
  mockUseCreate,
  mockMutate,
} = vi.hoisted(() => ({
  mockUseMyReviews: vi.fn(),
  mockUseAvailableTrips: vi.fn(),
  mockUseInfinite: vi.fn(),
  mockUseCreate: vi.fn(),
  mockMutate: vi.fn(),
}));

vi.mock("@/queries/useReviewsQuery", () => ({
  useMyReviewsQuery: mockUseMyReviews,
  useAvailableReviewTripsQuery: mockUseAvailableTrips,
  useUserReviewsInfiniteQuery: mockUseInfinite,
  useCreateReviewMutation: mockUseCreate,
}));

// Водитель поездки: адресаты подтверждены, значит форма показана целиком —
// оба Select и textarea комментария на экране сразу.
vi.mock("@/queries/useBookingsQuery", () => ({
  useTripBookingsQuery: () => ({
    data: {
      pages: [
        { items: [{ status: "confirmed", passenger: P1 }] },
        { items: [] },
      ],
    },
    error: null,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/queries/profile", () => ({
  useProfileQuery: () => ({
    data: { id: "u-me", name: "Я Водитель", rating: 4.8, reviewsCount: 12 },
    error: null,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user: { id: "u-me", name: "Я Водитель" } }),
    {
      setState: () => {},
      getState: () => ({ user: { id: "u-me" } }),
    },
  ),
}));

import { ReviewsBody } from "@/pages/Reviews/ReviewsPage";
import { ApiError } from "@/api/client";
import uiStyles from "@/ui/ui.module.css";

/** Автор отзыва — водитель поездки. */
const ME = {
  id: "u-me",
  name: "Я Водитель",
  avatar: "https://t.me/i/userpic/320/me.svg",
  rating: 4.8,
  reviewsCount: 12,
  tripsCount: 5,
};

/** Пассажир, ради которого водитель пишет отзыв. */
const P1 = { id: "u-p1", name: "Пётр Первый" };

const TRIP = {
  id: "t-1",
  fromCity: "Вологда",
  toCity: "Череповец",
  date: "10 сентября",
  time: "09:00",
  durationMinutes: 120,
  distanceKm: 130,
  price: 500,
  seatsTotal: 3,
  seatsAvailable: 2,
  driver: ME,
  tags: [],
  status: "completed",
};

function queryState(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderBody() {
  return render(
    <AppRoot platform="base">
      <MemoryRouter initialEntries={["/reviews"]}>
        <ReviewsBody initialTab="new" />
      </MemoryRouter>
    </AppRoot>,
  );
}

/** Контрол по доступному имени (label рисует ui/Field), а не по DOM-селектору. */
function selectByName(name: string): HTMLElement {
  return screen.getByRole("combobox", { name });
}

function commentByName(): HTMLElement {
  return screen.getByRole("textbox", { name: "Комментарий" });
}

/**
 * Доступное описание контрола: текст узлов, перечисленных в
 * aria-describedby (тот же разбор, что делает dom-accessibility-api).
 */
function accessibleDescription(control: HTMLElement): string {
  const ids = (control.getAttribute("aria-describedby") ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim();
}

function isInvalid(control: HTMLElement): boolean {
  return control.getAttribute("aria-invalid") === "true";
}

function type(control: HTMLElement, value: string) {
  fireEvent.change(control, { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /Отправить отзыв/ }));
}

beforeEach(() => {
  mockUseMyReviews.mockReturnValue(queryState({ data: [] }));
  mockUseAvailableTrips.mockReturnValue(queryState({ data: [TRIP] }));
  mockUseInfinite.mockReturnValue({
    ...queryState(),
    data: { pages: [] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  mockUseCreate.mockReturnValue({
    mutate: mockMutate,
    isPending: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReviewsBody: ошибка поля привязана к своему контролу", () => {
  it("ошибка про КОММЕНТАРИЙ достаётся фокусом textarea, а оба Select не помечены", () => {
    renderBody();
    const trip = selectByName("Поездка");
    const target = selectByName("Кому оставить отзыв");
    const comment = commentByName();

    // maxLength в jsdom не мешает присвоить value напрямую, а canSubmit
    // (непустой комментарий) кнопку включает — проверяется РЕАЛЬНЫЙ путь,
    // обработчик отправки, а не гейт кнопки.
    type(comment, "x".repeat(REVIEW_TEXT_MAX_LENGTH + 1));
    submit();

    const message = `Максимум ${REVIEW_TEXT_MAX_LENGTH} символов`;

    // Фокус на поле — и описание сразу даёт текст ошибки.
    comment.focus();
    expect(document.activeElement).toBe(comment);
    expect(accessibleDescription(comment)).toBe(message);
    expect(isInvalid(comment)).toBe(true);

    // Узел ошибки — живой регион с тем самым текстом, и он же id, на который
    // ссылается aria-describedby.
    const errorNode = document.getElementById(
      comment.getAttribute("aria-describedby") ?? "",
    );
    expect(errorNode?.getAttribute("role")).toBe("alert");
    expect(errorNode?.textContent).toBe(message);

    // Ошибка не про выборы — кольца на обоих Select быть не должно.
    for (const control of [trip, target]) {
      expect(isInvalid(control)).toBe(false);
      expect(control.getAttribute("aria-describedby")).toBeNull();
      expect(accessibleDescription(control)).toBe("");
    }
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("ошибка формы (ответ сервера) не помечает ни одно поле", () => {
    renderBody();
    const comment = commentByName();
    type(comment, "Отличная поездка");
    submit();

    // Мутация ответила 409 ALREADY_REVIEWED — сообщение НЕ про конкретное
    // поле, поэтому оно остаётся общей плашкой формы и ни один контрол
    // не должен выглядеть невалидным.
    const options = mockMutate.mock.calls[0]?.[1] as
      | { onError: (error: unknown) => void }
      | undefined;
    act(() => {
      options?.onError(
        new ApiError("уже отзыв", "ALREADY_REVIEWED", 409),
      );
    });

    expect(
      screen.getByText("Вы уже оставили отзыв об этом пользователе в этой поездке"),
    ).toBeTruthy();
    for (const control of [
      selectByName("Поездка"),
      selectByName("Кому оставить отзыв"),
      comment,
    ]) {
      expect(isInvalid(control)).toBe(false);
      expect(control.getAttribute("aria-describedby")).toBeNull();
      expect(accessibleDescription(control)).toBe("");
    }
  });

  it("правка поля гасит ТОЛЬКО свою ошибку", () => {
    renderBody();
    const trip = selectByName("Поездка");
    const comment = commentByName();
    type(comment, "x".repeat(REVIEW_TEXT_MAX_LENGTH + 1));
    submit();
    expect(isInvalid(comment)).toBe(true);

    // Смена поездки сбрасывает форму (resetTarget), ошибка уходит вместе с
    // ней — но выбор поездки не должен «пометить» поле комментария.
    fireEvent.change(trip, { target: { value: TRIP.id } });
    expect(isInvalid(comment)).toBe(false);
    expect(isInvalid(trip)).toBe(false);
    expect(accessibleDescription(comment)).toBe("");

    // Как только текст стал валидным, форма уходит на отправку.
    type(comment, "теперь корректно");
    submit();
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it("подпись поля на месте: правило --app-field-label не мёртвое", () => {
    renderBody();

    // Обёртка всегда несёт собственный класс Field (MEMORY.md §18), а
    // подпись — класс .fieldLabel: без них правило тона подписи мертво.
    // Классы хешированные, поэтому сверяемся с самим модулем ui/, а не со
    // строкой.
    for (const id of ["review-trip", "review-target", "review-text"]) {
      const control = document.getElementById(id);
      expect(control).not.toBeNull();
      expect(control?.closest(`.${uiStyles.fieldRoot}`)).not.toBeNull();
      expect(document.querySelector(`label[for="${id}"]`)?.className).toContain(
        uiStyles.fieldLabel,
      );
    }
  });

  it("до ошибок у полей нет ни aria-invalid, ни aria-describedby", () => {
    renderBody();
    for (const control of [
      selectByName("Поездка"),
      selectByName("Кому оставить отзыв"),
      commentByName(),
    ]) {
      expect(isInvalid(control)).toBe(false);
      expect(control.getAttribute("aria-describedby")).toBeNull();
      expect(accessibleDescription(control)).toBe("");
    }
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
