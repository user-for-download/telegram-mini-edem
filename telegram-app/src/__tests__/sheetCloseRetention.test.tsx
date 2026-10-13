// @vitest-environment jsdom
// Удержание контента шторки до размонтирования (B8).
//
// При закрытии target/report становится null, а Modal кита ещё играет
// анимацию закрытия. Если тело занулить вместе с пропом, шторка
// закрывается поверх пустоты — мигание. Поэтому обе шторки удерживают
// последний не-null target/report в ref до размонтирования.
//
// Почему тест смотрит в DOM после закрытия: vaul (под капотом Modal)
// размонтирует Drawer.Content только по концу анимации, а в jsdom
// анимации нет — портал остаётся смонтированным. Это ровно то же окно,
// что и живая анимация закрытия: на старом коде (`{target ? … : null}`)
// текст после закрытия исчезал (count 0), на новом — остаётся.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Report } from "@edem/contracts";
import {
  UserProfileProvider,
  useOpenUserProfile,
  type UserProfileTarget,
} from "@/components/Profile/UserProfileProvider";
import { handleModalBack } from "@/utils/modalBack";
import { ReportDetailsModal } from "@/pages/Reports/ReportDetailsModal";
import uiStyles from "@/ui/ui.module.css";
import titleStyles from "@/ui/SheetTitle.module.css";

vi.mock("@/queries/profile", () => ({
  useUserQuery: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FIRST: UserProfileTarget = {
  id: "u-1",
  initial: { name: "Первый Пользователь", rating: 5, reviewsCount: 1, tripsCount: 1 },
};

const SECOND: UserProfileTarget = {
  id: "u-2",
  initial: { name: "Второй Пользователь", rating: 4, reviewsCount: 2, tripsCount: 3 },
};

function ProfileProbe({ target = FIRST }: { target?: UserProfileTarget }) {
  const open = useOpenUserProfile();
  return (
    <button type="button" data-testid="open-profile" onClick={() => open(target)}>
      Открыть профиль
    </button>
  );
}

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "123e4567-e89b-12d3-a456-426614174000",
    targetType: "trip",
    targetId: "t-1",
    category: "safety",
    description: "Опасное вождение на трассе",
    status: "pending",
    resolutionNote: null,
    createdAt: "2026-09-09T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z",
    resolvedAt: null,
    ...overrides,
  };
}

describe("UserProfileSheet: контент жив до размонтирования", () => {
  it("после закрытия Back имя остаётся (анимация идёт поверх контента)", () => {
    render(
      <AppRoot platform="base">
        <UserProfileProvider>
          <ProfileProbe />
        </UserProfileProvider>
      </AppRoot>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Открыть профиль" }));
    expect(
      screen.queryAllByText("Первый Пользователь").length,
    ).toBeGreaterThan(0);

    // Закрытие — через тот же вход, что и Shell (useModalBack снят,
    // шторка закрыта, но НЕ размонтирована: провайдер живёт в Shell).
    act(() => {
      expect(handleModalBack()).toBe(true);
    });

    // Старый код давал 0: `{target ? … : null}` занулял тело вместе
    // с пропом, и закрытие шло поверх пустоты.
    expect(
      screen.queryAllByText("Первый Пользователь").length,
    ).toBeGreaterThan(0);
  });

  it("удержание не прилипает: повторное открытие показывает новый профиль", () => {
    // vaul прячет фон (inert) пока шторка открыта/закрывается, поэтому
    // клики — по testid: getByRole не видит кнопку за открытым диалогом,
    // а fireEvent на скрытом узле всё равно зовёт onClick.
    const openByTestId = () =>
      fireEvent.click(screen.getByTestId("open-profile"));
    const { rerender } = render(
      <AppRoot platform="base">
        <UserProfileProvider>
          <ProfileProbe target={FIRST} />
        </UserProfileProvider>
      </AppRoot>,
    );
    openByTestId();
    expect(
      screen.queryAllByText("Первый Пользователь").length,
    ).toBeGreaterThan(0);

    // Открытие поверх: новый target обязан заменить удержанный.
    rerender(
      <AppRoot platform="base">
        <UserProfileProvider>
          <ProfileProbe target={SECOND} />
        </UserProfileProvider>
      </AppRoot>,
    );
    openByTestId();
    expect(
      screen.queryAllByText("Второй Пользователь").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Первый Пользователь")).toBeNull();

    // И после закрытия удерживается именно последний.
    act(() => {
      expect(handleModalBack()).toBe(true);
    });
    expect(
      screen.queryAllByText("Второй Пользователь").length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Первый Пользователь")).toBeNull();
  });
});

describe("ReportDetailsModal: контент жив до размонтирования", () => {
  it("после закрытия описание остаётся (анимация идёт поверх контента)", () => {
    const { rerender } = render(
      <AppRoot platform="base">
        <ReportDetailsModal report={report()} onClose={() => {}} />
      </AppRoot>,
    );
    expect(
      screen.queryAllByText("Опасное вождение на трассе").length,
    ).toBeGreaterThan(0);

    rerender(
      <AppRoot platform="base">
        <ReportDetailsModal report={null} onClose={() => {}} />
      </AppRoot>,
    );

    // Старый код давал 0: `{report === null ? null : …}` занулял тело
    // вместе с пропом, и закрытие шло поверх пустоты.
    expect(
      screen.queryAllByText("Опасное вождение на трассе").length,
    ).toBeGreaterThan(0);
  });
});

describe("ReportDetailsModal: обвязка от ui/Sheet, а не от сырого Modal", () => {
  // Пока окно было собрано на китовом Modal напрямую, оно теряло три вещи,
  // которые даёт фасад. Главное из них — ВИДИМЫЙ заголовок: `ModalHeader`
  // кита рисует текст только при `platform === 'ios'`, поэтому на Android и
  // десктопе карточка жалобы открывалась вообще без названия.
  //
  // Пин по КЛАССУ фасада, а не по роли heading: скрытый h2 (VisuallyHidden
  // внутри китового Modal) тоже давал роль heading с тем же именем, и
  // запрос `getByRole("heading", {name})` проходил бы на обоих кодах —
  // проверка вхолостая. Класс `.title` из SheetTitle.module.css есть только
  // у видимой копии заголовка на base.
  it("на base есть видимый заголовок шторки (класс SheetTitle)", () => {
    render(
      <AppRoot platform="base">
        <ReportDetailsModal report={report()} onClose={() => {}} />
      </AppRoot>,
    );
    const title = document.querySelector(`.${titleStyles.title as string}`);
    expect(title).not.toBeNull();
    expect(title?.textContent).toBe("Жалоба");
  });

  it("имя диалога доступно скринридеру (скрытый h2 фасада)", () => {
    // Скрытое имя нужно независимо от платформы: на iOS его роль играет
    // Modal.Header, на base — видимый заголовок. Именно скрытый h2, а не
    // любая роль: он и есть accessible name модалки.
    render(
      <AppRoot platform="base">
        <ReportDetailsModal report={report()} onClose={() => {}} />
      </AppRoot>,
    );
    expect(
      screen.getAllByRole("heading", { name: "Жалоба", hidden: true }).length,
    ).toBeGreaterThan(0);
  });

  it("фокус при открытии уходит на ТЕЛО шторки, а не на Drawer китa", () => {
    // Рецепт SheetContent: обёртка тела получает tabIndex={-1} и focus() при
    // монтировании — точка входа для клавиатуры и скринридера.
    // Пин по классу тела (`--app-sheet-*` из ui.module.css): на сыром Modal
    // фокус оставался на самом Drawer.Content кита, который тоже
    // focusable — проверка «focus не на body» там прошла бы вхолостую.
    render(
      <AppRoot platform="base">
        <ReportDetailsModal report={report()} onClose={() => {}} />
      </AppRoot>,
    );
    const active = document.activeElement as HTMLElement | null;
    expect(active?.getAttribute("tabindex")).toBe("-1");
    expect(active?.className ?? "").toContain(uiStyles.sheetBody as string);
    expect(active?.textContent).toContain("Опасное вождение на трассе");
  });
});
