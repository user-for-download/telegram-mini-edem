// @vitest-environment jsdom
// Тесты шторки профиля другого человека.
//
// Проверяем то, что легко потерять:
//
//  1. useOpenUserProfile ВНЕ провайдера возвращает no-op, а не бросает.
//     Иначе упал бы весь SSR-пласт (renderToString карточек и отзывов
//     без обёртки) — регресс на пустом месте.
//  2. Back: закрытая шторка НЕ перехватывает нативную кнопку «Назад»
//     (она должна уводить по истории), открытая — перехватывает и
//     закрывается. Проверяем через handleModalBack — публичный вход,
//     которым пользуется Shell. Прямой спай на pushModalBackHandler
//     НЕ сработал бы: useModalBack вызывает её внутри того же модуля,
//     и подмена экспорта такой вызов не перехватывает. Первая версия
//     теста была зелёной даже с выключенной подпиской — вот эту ошибку
//     поведенческий тест ловит сразу.
//  3. Телефон чужого профиля не рисуется, даже если он есть в initial:
//     публичный ответ его не содержит, шапка не выдумывает PII.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  UserProfileProvider,
  useOpenUserProfile,
  type UserProfileTarget,
} from "@/components/Profile/UserProfileProvider";
import { handleModalBack } from "@/utils/modalBack";

const refetch = vi.fn();

// Состояние запроса — изменяемое: кейсы M1/M2 подменяют data/error под
// себя, а не живут на одном статичном моке.
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: {
    current: {
      data: null as null | Record<string, unknown>,
      isLoading: false,
      error: null as unknown,
    },
  },
}));

vi.mock("@/queries/profile", () => ({
  useUserQuery: () => ({
    data: mockQuery.current.data,
    isLoading: mockQuery.current.isLoading,
    error: mockQuery.current.error,
    refetch,
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mockQuery.current = { data: null, isLoading: false, error: null };
});

const FULL: UserProfileTarget = {
  id: "u-1",
  initial: {
    name: "Александр Иванов",
    rating: 4.9,
    reviewsCount: 12,
    tripsCount: 34,
    about: "За рулём 7 лет",
    car: { model: "Lada Vesta", color: "белый" },
    // Телефон подсовываем НАРУЖУ типа: тип initial его запрещает, но в
    // реальности initial собирается из полного User водителя, у которого
    // при подтверждённой бронь phone ЕСТЬ (trips/index.ts отдаёт его
    // подтверждённому пассажиру). Это и есть настоящая угроза утечке —
    // поэтому проверяем, что шторка игнорирует поле даже когда оно есть.
    phone: "+7 900 123-45-67",
  } as UserProfileTarget["initial"],
};

const MINIMAL: UserProfileTarget = {
  id: "u-2",
  initial: {
    name: "Мария",
    rating: 5,
    reviewsCount: 0,
    tripsCount: 1,
  },
};

function Probe({ target = FULL }: { target?: UserProfileTarget }) {
  const open = useOpenUserProfile();
  return (
    <button type="button" onClick={() => open(target)}>
      Открыть профиль
    </button>
  );
}

/** Клик по кнопке «Открыть профиль» в обёртке (или без неё). */
function clickOpen(target?: UserProfileTarget) {
  fireEvent.click(
    screen.getByRole("button", { name: "Открыть профиль" }),
    undefined,
  );
  return target;
}

function renderWithProvider(target?: UserProfileTarget) {
  return render(
    <AppRoot platform="base">
      <UserProfileProvider>
        <Probe target={target} />
      </UserProfileProvider>
    </AppRoot>,
  );
}

function renderWithoutProvider() {
  return render(
    <AppRoot platform="base">
      <Probe />
    </AppRoot>,
  );
}

describe("useOpenUserProfile", () => {
  it("вне провайдера отдаёт рабочий no-op, а не бросает", () => {
    // Рендер БЕЗ провайдера — как в SSR-тестах карточек и отзывов.
    expect(() => renderWithoutProvider()).not.toThrow();
  });

  it("вне провайдера клик по кнопке безвреден", () => {
    renderWithoutProvider();
    expect(() => clickOpen()).not.toThrow();
    // И Back не перехватывается пустым контекстом.
    expect(handleModalBack()).toBe(false);
  });
});

describe("UserProfileSheet: содержимое", () => {
  it("показывает имя, рейтинг, «О себе» и автомобиль", () => {
    renderWithProvider();
    clickOpen();

    // Имя есть и в заголовке шторки, и в шапке — сверяем наличие, не число.
    expect(screen.getAllByText("Александр Иванов").length).toBeGreaterThan(0);
    expect(screen.getByText("поездок: 34")).toBeTruthy();
    expect(screen.getByText("12 отзывов")).toBeTruthy();
    expect(screen.getByText("За рулём 7 лет")).toBeTruthy();
    expect(screen.getByText("Lada Vesta · белый")).toBeTruthy();
  });

  it("телефон, протёкший в initial, НЕ рисуется", () => {
    renderWithProvider();
    clickOpen();

    // Тип initial телефон запрещает, а шторка всё равно его не рисует:
    // публичный ответ (serializePublicUser) телефона не содержит, так что
    // показать его — значит показать PII, которого этот экран не получал.
    expect(screen.queryByText("+7 900 123-45-67")).toBeNull();
  });

  it("без «О себе» и без авто блоки не рисуются", () => {
    renderWithProvider(MINIMAL);
    fireEvent.click(screen.getByRole("button", { name: "Открыть профиль" }));

    expect(screen.getAllByText("Мария").length).toBeGreaterThan(0);
    expect(screen.queryByText("О себе")).toBeNull();
    expect(screen.queryByText("Lada Vesta · белый")).toBeNull();
  });
});

describe("UserProfileSheet: ошибка не затирает показанное (M1)", () => {
  it("фоновый 500 при живом initial — карточка на месте, а не loadError", () => {
    // Сценарий: шторка открыта по initial, фоновый refetch (например,
    // инвалидация после отзыва) упал. Показывать вместо карточки
    // полноэкранный loadError — значит отбирать данные, которые уже
    // на руках у пользователя.
    mockQuery.current = {
      data: null,
      isLoading: false,
      error: new Error("Internal Server Error"),
    };
    renderWithProvider();
    clickOpen();

    expect(screen.getAllByText("Александр Иванов").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Не удалось загрузить/i)).toBeNull();
  });

  it("без initial ошибка показывается с повтором", () => {
    // Открытие только по id (initial опционален): показать нечего —
    // здесь loadError честен, и retry зовёт refetch.
    mockQuery.current = {
      data: null,
      isLoading: false,
      error: new Error("Internal Server Error"),
    };
    render(
      <AppRoot platform="base">
        <UserProfileProvider>
          <Probe target={{ id: "u-9" }} />
        </UserProfileProvider>
      </AppRoot>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Открыть профиль" }));

    expect(screen.getByRole("button", { name: "Повторить" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(refetch).toHaveBeenCalled();
  });
});

describe("UserProfileSheet: заголовок следует данным (M2)", () => {
  it("догруженное имя заменяет initial в заголовке", () => {
    // Открыли по устаревшему initial, сервер вернул новое имя: заголовок
    // шторки (и aria-labelledby диалога) обязан отрази́ть данные, а не
    // застывший initial.
    mockQuery.current = {
      data: {
        id: "u-1",
        name: "Александр Петров",
        avatar: null,
        rating: 4.9,
        reviewsCount: 12,
        tripsCount: 34,
      },
      isLoading: false,
      error: null,
    };
    renderWithProvider();
    clickOpen();

    expect(screen.getAllByText("Александр Петров").length).toBeGreaterThan(0);
    expect(screen.queryByText("Александр Иванов")).toBeNull();
  });
});

describe("UserProfileSheet: нативный Back", () => {
  it("закрытая шторка не перехватывает Back", () => {
    renderWithProvider();
    // Back должен увести по истории, а не закрывать несуществующее окно.
    expect(handleModalBack()).toBe(false);
  });

  it("открытая шторка перехватывает Back и закрывается", () => {
    renderWithProvider();
    clickOpen();

    // Без useModalBack Back ушёл бы с экрана вместо закрытия шторки.
    // Обработка внутри act: onClose снимает подписку в cleanup эффекта,
    // и без act ре-рендер не прошёл бы — проверяли бы React-тайминг,
    // а не поведение шторки.
    let intercepted = false;
    act(() => {
      intercepted = handleModalBack();
    });
    expect(intercepted).toBe(true);
    // Шторка закрылась и освободила Back экрану под собой.
    expect(handleModalBack()).toBe(false);
  });
});
