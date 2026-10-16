// @vitest-environment jsdom
// F26: неинтерактивные строки `ui/Cell` перестают ОБЕЩАТЬ нажатие.
//
// Дефект: кит внутри `Cell` всегда тянет `Tappable`, а тот безусловно вешает
// `cursor:pointer` (`tgui-b5d680db78c4cc2e`) и hover-подложку
// (`.tgui-…:hover{background:var(--tgui--tertiary_bg_color)}`) — независимо
// от `Component` и от наличия `onClick` (проверено в установленном
// @telegram-apps/telegram-ui@2.1.13: `dist/styles.css` и `Cell.js:35-38`,
// где корневому классу клетки всегда предшествует базовый класс Tappable).
// На строке, по которой нельзя нажать, это ложная аффордансность.
//
// Что здесь закрепляется:
//  1. СТАТИЧНЫЕ строки несут `STATIC_CELL` (ui/classes.ts → ui.module.css
//     `.staticCell{cursor:default}` + `:hover{background:transparent}`) —
//     тот же приём, что в RideRequestFeedSection;
//  2. такие строки остаются обычными `div`: ни роли, ни tabIndex, ни
//     обработчика — в дереве доступности ничего интерактивного;
//  3. ИНТЕРАКТИВНЫЕ строки `STATIC_CELL` НЕ получают: гасить настоящий
//     аффорданс хуже, чем оставить лишний. Обе кликабельны через родителя
//     (см. ниже), поэтому «слепо повесить класс на все четыре места» из
//     исходного описания F26 — регресс, и тест ниже его стопит.
//
// Про `getComputedStyle`: итоговый `cursor` здесь проверить НЕЛЬЗЯ. Vitest по
// умолчанию не внедряет стили (`css: false`), а `@layer` jsdom не реализует
// вовсе — тот же прецедент зафиксирован в
// `components/__tests__/targetSizes.test.tsx:10` («jsdom не каскадит
// CSS-модули»). Поэтому пин делается по двум проверяемым в jsdom слоям:
// класс на элементе (то, что реально чинит баг) и неинтерактивная природа
// элемента; правило самого класса пинится чтением исходника.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";

const authState = vi.hoisted(() => ({
  user: null as { onboardingVersion: string | null } | null,
}));

vi.mock("@/store/useAuthStore", () => ({
  useAuthStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ user: authState.user }),
    { setState: () => {}, getState: () => ({ user: authState.user }) },
  ),
}));

vi.mock("@/api/users.api", () => ({
  usersApi: { completeOnboarding: vi.fn(), deleteCurrentUser: vi.fn() },
}));

// Провайдеры, которые нужны строке заявки, — подменяем: тест проверяет
// кликабельность СТРОКИ, а не шторку профиля и тосты.
vi.mock("@/components/Profile/UserProfileProvider", () => ({
  useOpenUserProfile: () => vi.fn(),
}));
vi.mock("@/components/Toast/ToastProvider", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

const driverQuery = vi.hoisted(() => ({ data: [] as unknown[] }));

vi.mock("@/queries/useBookingsQuery", () => ({
  useDriverRequestsQuery: () => ({ data: driverQuery.data, isLoading: false, error: null, refetch: vi.fn() }),
  useUpdateBookingStatusMutation: () => ({
    isPending: false,
    variables: undefined,
    error: null,
    mutate: vi.fn(),
  }),
}));

import { Onboarding } from "@/components/Onboarding/Onboarding";
import { DriverTripRequests } from "@/components/Trip/DriverTripRequests";
import { TripStandardCard } from "@/components/Section/TripStandardCard";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { STATIC_CELL } from "@/ui/classes";

const here = dirname(fileURLToPath(import.meta.url));
/** Исходник компонента относительно components/__tests__/. */
const readSrc = (relativePath: string): string =>
  readFileSync(join(here, "..", "..", relativePath), "utf8");

afterEach(cleanup);

function renderOnboarding() {
  // Версия устарела — иначе компонент отдаёт children сквозняком.
  authState.user = { onboardingVersion: "0" };
  return render(
    <AppRoot platform="base">
      <Onboarding>
        <span>Лента</span>
      </Onboarding>
    </AppRoot>,
  );
}

function renderCard(
  props: Partial<React.ComponentProps<typeof TripStandardCard>> = {},
) {
  return render(
    <AppRoot platform="base">
      <TripStandardCard
        tripId="t-1"
        fromCity="Вологда"
        toCity="Черецовец"
        departureAt={new Date(Date.now() + 3_600_000).toISOString()}
        price={450}
        headerStatus={<StatusPill tone="warning">Ожидает</StatusPill>}
        person={{
          name: "Александр",
          rating: 4.9,
          reviewsCount: 12,
          tripsCount: 30,
          subtitle: "Lada Vesta · белый",
        }}
        onOpen={() => {}}
        {...props}
      />
    </AppRoot>,
  );
}

describe("F26: статичные строки Onboarding не рекламируют нажатие", () => {
  it("все три строки несут STATIC_CELL", () => {
    const { container } = renderOnboarding();

    const rows = Array.from(
      container.querySelectorAll<HTMLElement>(`.${STATIC_CELL}`),
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Доверие"),
      expect.stringContaining("Ответственность"),
      expect.stringContaining("Минимум данных"),
    ]);
  });

  it("строка остаётся неинтерактивным элементом: div без роли и tabIndex", () => {
    const { container } = renderOnboarding();

    for (const row of container.querySelectorAll<HTMLElement>(
      `.${STATIC_CELL}`,
    )) {
      expect(row.tagName).toBe("DIV");
      // Ничего, что сделало бы строку доступной как действие.
      expect(row.getAttribute("role")).toBeNull();
      expect(row.getAttribute("tabindex")).toBeNull();
      expect(row.getAttribute("onclick")).toBeNull();
    }
  });

  it("в шапке секции клеток нет — это не пункт меню, а текст договора", () => {
    // Клетки не должны превратиться в кнопки: единственное действие экрана —
    // «Я согласен» ниже.
    const { container } = renderOnboarding();

    for (const row of container.querySelectorAll<HTMLElement>(
      `.${STATIC_CELL}`,
    )) {
      expect(row.querySelector("button")).toBeNull();
    }
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });
});

describe("F26: интерактивные строки STATIC_CELL не получают", () => {
  it("строка персоны TripStandardCard лежит ВНУТРИ кнопки открытия", () => {
    // `personCell` — внутри `.open` (открыть поездку) либо `.personButton`
    // (открыть профиль). Обе кнопки сами дают `cursor:pointer`, а тап по
    // строке реально что-то делает: аффорданс настоящий, гасить нельзя.
    renderCard();

    const open = screen.getByRole("button", { name: /Открыть поездку/ });
    const personName = screen.getByText("Александр");
    expect(open.contains(personName)).toBe(true);
    expect(
      document.querySelectorAll(`.${STATIC_CELL}`).length,
    ).toBe(0);
  });

  it("тап по строке заявки водителя открывает поездку — аффорданс настоящий", () => {
    // `DriverTripRequests` приходит в карточку как `personOverride`, то есть
    // СОСЕДОМ кнопки открытия, внутри `Card onClick={open}` (ui/README.md #24:
    // «строка заявки водителя — да»). Класс означал бы, что тап по строке
    // ничего не делает, — а он открывает детали поездки. Это ПОВЕДЕНИЕ, а не
    // текст исходника: иначе следующий рефакторинг комментария тихо
    // «уронит» решение.
    driverQuery.data = [
      {
        id: "b-1",
        seat: 1,
        status: "pending",
        comment: null,
        passenger: {
          id: "u-9",
          name: "Иван",
          avatar: null,
          rating: 4.5,
          reviewsCount: 3,
        },
        trip: { id: "t-1" },
      },
    ];
    const onOpen = vi.fn();
    renderCard({ personOverride: <DriverTripRequests tripId="t-1" />, onOpen });

    // Тапаем по подписи строки — той самой области, ради которой класс
    // `STATIC_CELL` и не вешается.
    fireEvent.click(screen.getByText(/место №1/));

    expect(onOpen).toHaveBeenCalledWith("t-1");
    expect(
      document.querySelectorAll(`.${STATIC_CELL}`).length,
    ).toBe(0);
  });

  it("STATIC_CELL по-прежнему определён фасадом и снимает курсор", () => {
    // Пин самого механизма: класс не переименовывается и не теряет
    // `cursor:default` — иначе STATIC_CELL на вызывающих станет no-op.
    const css = readSrc("ui/ui.module.css");
    expect(css).toMatch(/\.staticCell\s*\{[^}]*cursor:\s*default/);
    expect(css).toMatch(
      /\.staticCell:hover\s*\{[^}]*background:\s*transparent/,
    );
    // Фасад в этом subtask не меняется: STATIC_CELL — экспорт classes.ts.
    expect(readSrc("ui/classes.ts")).toContain(
      "export const STATIC_CELL = styles.staticCell;",
    );
  });
});
