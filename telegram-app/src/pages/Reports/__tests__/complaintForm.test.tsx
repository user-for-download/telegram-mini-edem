// SSR-тесты формы жалобы — тело всплывающего окна ComplaintModal (Modal —
// портал и в renderToString не попадает). Паттерн tripsPages.test.tsx (SSR,
// моки хуков через vi.hoisted).
//
// id полей — контракт формы: на них возвращает id `reportErrorMessage`,
// поэтому пинятся здесь, а не в разметке страницы.
//
// Хинт о повторной жалобе и отправка — в complaintForm.submit.test.tsx (jsdom):
// хинт зависит от ВВЕДЁННОГО id, а renderToString не умеет печатать.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { REPORT_DESCRIPTION_MAX_LENGTH } from "@edem/contracts";

const { mockUseCreate, mockToastShow } = vi.hoisted(() => ({
  mockUseCreate: vi.fn(),
  mockToastShow: vi.fn(),
}));

vi.mock("@/queries/useReportQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useReportQuery")>();
  return { ...original, useCreateReportMutation: mockUseCreate };
});

// Тост подтверждения: после отправки окно закрывается, inline-Notice уехал бы
// вместе с ним.
vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: mockToastShow }) };
});

import { ComplaintForm } from "@/pages/Reports/ComplaintForm";

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
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ComplaintForm", () => {
  it("селекты типа/категории с русскими подписями и кнопка ≥44px", () => {
    const html = renderForm();

    expect(html).toContain("Пользователь");
    expect(html).toContain("Поездка");
    expect(html).toContain("Бронь");
    expect(html).toContain("Безопасность");
    expect(html).toContain("Мошенничество");
    expect(html).toContain("Недостоверная информация");
    expect(html).toContain("Отправить жалобу");
    expect(html).toContain('data-tap-target="44"');
  });

  it("id полей и maxLength описания из контракта", () => {
    const html = renderForm();

    expect(html).toContain('id="report-target-type"');
    expect(html).toContain('id="report-target-id"');
    expect(html).toContain('id="report-category"');
    expect(html).toContain('id="report-description"');
    // React 19 в SSR пишет атрибут как maxLength (не в нижнем регистре).
    expect(html).toContain(`maxLength="${REPORT_DESCRIPTION_MAX_LENGTH}"`);
  });

  it("кнопка погашена на пустой форме", () => {
    expect(renderForm()).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?Отправить жалобу/);
  });

  it("самой страницы в форме нет — только поля", () => {
    const html = renderForm();

    expect(html).not.toContain("Мои жалобы");
    expect(html).not.toContain("Мои обращения");
  });
});
