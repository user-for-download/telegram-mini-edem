// SSR-тесты формы жалобы — тело всплывающего окна ComplaintModal (Modal —
// портал и в renderToString не попадает). Паттерн tripsPages.test.tsx (SSR,
// моки хуков через vi.hoisted).
//
// id полей — контракт формы: на них ссылается reportValidation, поэтому
// пинятся здесь, а не в разметке страницы.
//
// Хинт о повторной жалобе и отправка — в complaintForm.submit.test.tsx
// (jsdom): хинт зависит от ВЫБРАННОГО объекта, а renderToString не умеет
// печатать выбор.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { REPORT_DESCRIPTION_MAX_LENGTH } from "@edem/contracts";
import type { ReportTargets } from "@edem/contracts";

const { mockUseCreate, mockUseTargets, mockToastShow } = vi.hoisted(() => ({
  mockUseCreate: vi.fn(),
  mockUseTargets: vi.fn(),
  mockToastShow: vi.fn(),
}));

vi.mock("@/queries/useReportQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useReportQuery")>();
  return {
    ...original,
    useCreateReportMutation: mockUseCreate,
    useReportTargetsQuery: mockUseTargets,
  };
});

// Тост подтверждения: после отправки окно закрывается, inline-Notice уехал бы
// вместе с ним.
vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: mockToastShow }) };
});

import { ComplaintForm } from "@/pages/Reports/ComplaintForm";

const TARGETS: ReportTargets = [
  {
    targetType: "trip",
    id: "t-1",
    fromCity: "Москва",
    toCity: "Тула",
    departureAt: "2026-10-12T09:00:00.000Z",
  },
  {
    targetType: "booking",
    id: "b-1",
    fromCity: "Москва",
    toCity: "Тула",
    departureAt: "2026-10-12T09:00:00.000Z",
  },
  { targetType: "user", id: "u-1", name: "Иван Петров" },
];

function renderForm(): string {
  return renderToString(
    <AppRoot platform="base">
      <ComplaintForm reports={[]} />
    </AppRoot>,
  );
}

beforeEach(() => {
  mockUseCreate.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    error: null,
  });
  mockUseTargets.mockReturnValue({
    data: TARGETS,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ComplaintForm", () => {
  it("объекты из списка с подписями «тип: маршрут/имя, дата»", () => {
    const html = renderForm();

    // Объект выбирается из серверного списка, UUID вручную не вводится.
    expect(html).toContain("Поездка: Москва → Тула, 12.10.2026");
    expect(html).toContain("Бронь: Москва → Тула, 12.10.2026");
    expect(html).toContain("Пользователь: Иван Петров");
    expect(html).toContain("Безопасность");
    expect(html).toContain("Мошенничество");
    expect(html).toContain("Недостоверная информация");
    expect(html).toContain("Отправить жалобу");
    expect(html).toContain('data-tap-target="44"');
  });

  it("id полей и maxLength описания из контракта", () => {
    const html = renderForm();

    expect(html).toContain('id="report-target"');
    expect(html).toContain('id="report-category"');
    expect(html).toContain('id="report-description"');
    // React 19 в SSR пишет атрибут как maxLength (не в нижнем регистре).
    expect(html).toContain(`maxLength="${REPORT_DESCRIPTION_MAX_LENGTH}"`);
  });

  it("кнопка погашена на пустой форме", () => {
    expect(renderForm()).toMatch(
      /<button[^>]*disabled[^>]*>[\s\S]*?Отправить жалобу/,
    );
  });

  it("пока список грузится — поле закрыто и подписано «Загрузка…»", () => {
    mockUseTargets.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderForm();

    expect(html).toContain("Загрузка…");
    expect(html).toMatch(/<select[^>]*disabled/);
  });

  it("пустой список — подсказка, поле закрыто", () => {
    mockUseTargets.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    const html = renderForm();

    expect(html).toContain("Нет объектов, на которые можно пожаловаться");
    expect(html).toMatch(/<select[^>]*disabled/);
  });

  it("самой страницы в форме нет — только поля", () => {
    const html = renderForm();

    expect(html).not.toContain("Мои жалобы");
    expect(html).not.toContain("Мои обращения");
  });
});
