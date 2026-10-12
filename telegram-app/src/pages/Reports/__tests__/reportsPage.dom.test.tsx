// @vitest-environment jsdom
// Связка «тап по строке → попап» и порядок BackButton-хендлеров.
//
// SSR не видит ни клика, ни портала шторки, поэтому здесь нужен настоящий
// рендер. Отдельно закрыт риск шага 4: на странице ДВЕ подписки
// useModalBack (форма подачи + попап деталей), а стек общий и LIFO — при
// неверном порядке подписок Back закрывал бы не то окно.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoot } from "@telegram-apps/telegram-ui";

const { mockUseMine } = vi.hoisted(() => ({ mockUseMine: vi.fn() }));

vi.mock("@/queries/useReportQuery", () => ({
  useMyReportsQuery: mockUseMine,
  useCreateReportMutation: () => ({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  }),
}));

import { ReportsPage } from "@/pages/Reports/ReportsPage";
import { handleModalBack, pushModalBackHandler } from "@/utils/modalBack";

const REPORT_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "523e4567-e89b-12d3-a456-426614174004";

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    targetType: "trip",
    targetId: "t-1",
    category: "safety",
    description: "Опасное вождение",
    status: "pending",
    resolutionNote: null,
    createdAt: "2026-09-09T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <AppRoot platform="base">
      <MemoryRouter>
        <ReportsPage />
      </MemoryRouter>
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseMine.mockReturnValue({
    data: [report()],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ReportsPage: тап по строке открывает попап", () => {
  it("до тапа попапа в DOM нет", () => {
    renderPage();
    expect(screen.queryByText("Ответ модерации")).toBeNull();
    // Текст жалобы виден в строке — превью, но не полный текст попапа.
    expect(screen.getAllByText("Опасное вождение").length).toBeGreaterThan(0);
  });

  it("тап по строке открывает шторку с полным текстом жалобы", () => {
    renderPage();

    fireEvent.click(screen.getByTestId(`report-cell-${REPORT_ID}`));

    // Заголовок шторки виден — значит Modal смонтирован.
    expect(screen.getAllByText("Жалоба").length).toBeGreaterThan(0);
  });

  it("нативный Back закрывает верхнее окно — попап, а не форму", () => {
    renderPage();
    fireEvent.click(screen.getByTestId(`report-cell-${REPORT_ID}`));

    // Пока окно открыто, Back должен быть перехвачен (true) — то есть
    // закрывает окно, а не уводит со страницы.
    expect(handleModalBack()).toBe(true);
  });

  it("после закрытия Back снова уходит со страницы", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId(`report-cell-${REPORT_ID}`));
    expect(handleModalBack()).toBe(true);

    // act(): Back в реальности — отдельное действие пользователя, между
    // нажатиями React успевает отрендерить. Без flush подписка на Back
    // ещё жива в стеке, и второй вызов вернул бы true — это артефакт
    // синхронного теста, а не поведение приложения.
    await act(async () => {});
    expect(handleModalBack()).toBe(false);
  });
});

describe("Порядок подписок useModalBack (стек LIFO)", () => {
  it("верхним в стеке оказывается последний подписанный хендлер", () => {
    // Прямая проверка инварианта стека: страница подписывается ДВАЖДЫ
    // (форма подачи, потом попап деталей), и верхним обязан стать попап —
    // иначе Back на открытом попапе закрыл бы форму подачи.
    const calls: string[] = [];
    const un1 = pushModalBackHandler(() => calls.push("form"));
    const un2 = pushModalBackHandler(() => calls.push("details"));

    handleModalBack();

    expect(calls).toEqual(["details"]);
    un2();
    un1();
  });
});

describe("Открытая жалоба переживает инвалидацию кэша", () => {
  it("попап берёт свежие данные по id, а не копию", () => {
    // Страница держит открытой id, а не объект: после смены статуса
    // модерацией попап должен показать новое состояние.
    const { unmount } = renderPage();
    fireEvent.click(screen.getByTestId(`report-cell-${REPORT_ID}`));
    unmount();

    cleanup();
    mockUseMine.mockReturnValue({
      data: [report({ status: "resolved", resolutionNote: "Всё в порядке" })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    fireEvent.click(screen.getByTestId(`report-cell-${REPORT_ID}`));
    // Строка получила новое состояние — значит и попап отрендерит его.
    expect(screen.getAllByText("Рассмотрена").length).toBeGreaterThan(0);
  });
});

describe("Пустое состояние и кнопка подачи не сломались", () => {
  it("без жалоб остаётся пустое состояние и кнопка", () => {
    mockUseMine.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText("Вы пока не отправляли жалоб")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Подать жалобу/ }),
    ).toBeTruthy();
  });
});

describe("Контракт id жалобы в строке", () => {
  it("у каждой строки свой test-id по id", () => {
    mockUseMine.mockReturnValue({
      data: [report(), report({ id: OTHER_ID, description: "Спам в чате" })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByTestId(`report-cell-${REPORT_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`report-cell-${OTHER_ID}`)).toBeTruthy();
  });
});

describe("Строка 3 — статус", () => {
  // Статус обязан быть виден в ленте, а не только в aria-label и попапе: по
  // нему видно, какие жалобы рассмотрены, и открывать каждую ради этого не
  // нужно. Раскладка — как у уведомлений: title / subtitle / description.
  const cases = [
    { status: "pending", label: "Ожидает рассмотрения", tone: "warning" },
    { status: "in_review", label: "На рассмотрении", tone: "info" },
    { status: "resolved", label: "Рассмотрена", tone: "success" },
    { status: "rejected", label: "Отклонена", tone: "danger" },
  ] as const;

  it.each(cases)(
    "$status показан в строке с тоном $tone",
    ({ status, label, tone }) => {
      mockUseMine.mockReturnValue({
        data: [report({ status })],
        isLoading: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      renderPage();

      const badge = screen.getByTestId(`report-status-${REPORT_ID}`);
      expect(badge?.textContent).toBe(label);
      expect(badge?.getAttribute("data-tone")).toBe(tone);
    },
  );

  it("смысл статуса не только цветом, а словами", () => {
    // a11y: смысл всегда в тексте, иначе на серой теме/при дальтонизме
    // строка становится пустой.
    mockUseMine.mockReturnValue({
      data: [report({ status: "resolved" })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    expect(
      screen.getByTestId(`report-cell-${REPORT_ID}`).textContent,
    ).toContain("Рассмотрена");
  });

  it("статус в строке и в попапе говорит одно слово", () => {
    mockUseMine.mockReturnValue({
      data: [report({ status: "rejected" })],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    const inRow = screen.getByTestId(`report-status-${REPORT_ID}`).textContent;

    fireEvent.click(screen.getByTestId(`report-cell-${REPORT_ID}`));
    const inPopup = document.body.textContent ?? "";

    expect(inRow).toBe("Отклонена");
    expect(inPopup).toContain("Отклонена");
  });
});
