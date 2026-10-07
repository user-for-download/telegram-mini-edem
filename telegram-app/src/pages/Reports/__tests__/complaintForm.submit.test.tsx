// @vitest-environment jsdom
// Форма жалобы: хинт о повторной жалобе и отправка.
//
// Хинт зависит от введённого id (hasExistingReport возвращает false на пустом
// поле), поэтому SSR здесь бессилен — нужен ввод. Заодно проверяем, что
// успех уходит тостом и окно закрывается через onSubmitted: inline-Notice уехал
// бы вместе с окном.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Report } from "@edem/contracts";

// Мутация отдельным моком: useCreateReportMutation — хук, он зовётся на
// каждом рендере, и его счётчик.calls измерял бы рендеры, а не отправку.
const { mockMutate, mockToastShow } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockToastShow: vi.fn(),
}));

vi.mock("@/queries/useReportQuery", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/queries/useReportQuery")>();
  return {
    ...original,
    useCreateReportMutation: () => ({
      mutate: mockMutate,
      isPending: false,
      error: null,
    }),
  };
});

vi.mock("@/components/Toast/ToastProvider", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/components/Toast/ToastProvider")>();
  return { ...original, useToast: () => ({ show: mockToastShow }) };
});

import { ComplaintForm } from "@/pages/Reports/ComplaintForm";

const EXISTING_ID = "11111111-1111-4111-8111-111111111111";

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "r-1",
    targetType: "trip",
    targetId: EXISTING_ID,
    category: "safety",
    description: "Опасная поездка",
    status: "in_review",
    resolutionNote: null,
    createdAt: "2026-09-09T10:00:00.000Z",
    updatedAt: "2026-09-09T10:00:00.000Z",
    ...overrides,
  } as Report;
}

function renderForm(reports: Report[] = [], onSubmitted?: () => void) {
  return render(
    <AppRoot platform="base">
      <ComplaintForm reports={reports} onSubmitted={onSubmitted} />
    </AppRoot>,
  );
}

function fill(targetId: string, description = "Грубое вождение") {
  fireEvent.change(screen.getByLabelText("Идентификатор объекта"), {
    target: { value: targetId },
  });
  fireEvent.change(screen.getByLabelText("Описание"), {
    target: { value: description },
  });
}

beforeEach(() => {
  // Мутация сразу зовёт onSuccess — как успешный ответ сервера.
  mockMutate.mockImplementation(
    (_data: unknown, options?: { onSuccess?: () => void }) =>
      options?.onSuccess?.(),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ComplaintForm: ввод и отправка", () => {
  it("хинт о повторной жалобе появляется по id, под который уже жаловались", () => {
    renderForm([report()]);

    fill(EXISTING_ID);

    expect(screen.getByText(/Вы уже отправляли жалобу/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Жалоба уже отправлена" })).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("чужой id — жалоба отправляется: тело, тост и закрытие окна", () => {
    const onSubmitted = vi.fn();
    renderForm([report()], onSubmitted);

    fill("22222222-2222-4222-8222-222222222222", "Опоздал и был груб");
    fireEvent.click(screen.getByRole("button", { name: "Отправить жалобу" }));

    const mutate = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(mutate).toMatchObject({
      targetType: "trip",
      targetId: "22222222-2222-4222-8222-222222222222",
      category: "safety",
      description: "Опоздал и был груб",
    });
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Жалоба отправлена" }),
    );
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("без id жалоба не уходит", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Без идентификатора" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить жалобу" }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockToastShow).not.toHaveBeenCalled();
  });
});
