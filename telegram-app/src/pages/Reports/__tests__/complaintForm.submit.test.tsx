// @vitest-environment jsdom
// Форма жалобы: выбор объекта, хинт о повторной жалобе и отправка.
//
// Хинт зависит от выбранного объекта (hasExistingReport возвращает false без
// выбора), поэтому SSR здесь бессилен — нужен выбор. Заодно проверяем, что
// успех уходит тостом и окно закрывается через onSubmitted: inline-Notice уехал
// бы вместе с окном.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Report, ReportTargets } from "@edem/contracts";

// Мутация отдельным моком: useCreateReportMutation — хук, он зовётся на
// каждом рендере, и его счётчик.calls измерял бы рендеры, а не отправку.
const { mockMutate, mockUseTargets, mockToastShow } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockUseTargets: vi.fn(),
  mockToastShow: vi.fn(),
}));

vi.mock("@/queries/useReportQuery", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/queries/useReportQuery")>();
  return {
    ...original,
    useReportTargetsQuery: mockUseTargets,
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

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const TARGETS: ReportTargets = [
  {
    targetType: "trip",
    id: TRIP_ID,
    fromCity: "Москва",
    toCity: "Тула",
    departureAt: "2026-10-12T09:00:00.000Z",
  },
  { targetType: "user", id: USER_ID, name: "Иван Петров" },
];

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: "r-1",
    targetType: "trip",
    targetId: TRIP_ID,
    category: "safety",
    description: "Опасная поездка",
    status: "in_review",
    resolutionNote: null,
    resolvedAt: null,
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

function fill(targetKey: string, description = "Грубое вождение") {
  fireEvent.change(screen.getByLabelText("На что жалуетесь"), {
    target: { value: targetKey },
  });
  fireEvent.change(screen.getByLabelText("Описание"), {
    target: { value: description },
  });
}

beforeEach(() => {
  mockUseTargets.mockReturnValue({
    data: TARGETS,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
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

describe("ComplaintForm: выбор объекта и отправка", () => {
  it("хинт о повторной жалобе появляется по выбранному объекту", () => {
    renderForm([report()]);

    fill(`trip:${TRIP_ID}`);

    expect(screen.getByText(/Вы уже отправляли жалобу/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Жалоба уже отправлена" }),
    ).toBeTruthy();
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("тип и id берутся из выбранной опции — рассинхрон невозможен", () => {
    const onSubmitted = vi.fn();
    renderForm([], onSubmitted);

    // Выбираем человека: тело обязано уйти с targetType "user" и его id.
    fill(`user:${USER_ID}`);
    fireEvent.click(screen.getByRole("button", { name: "Отправить жалобу" }));

    const mutate = mockMutate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(mutate).toMatchObject({
      targetType: "user",
      targetId: USER_ID,
      category: "safety",
      description: "Грубое вождение",
    });
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Жалоба отправлена" }),
    );
    expect(onSubmitted).toHaveBeenCalled();
  });

  it("без выбранного объекта жалоба не уходит", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("Описание"), {
      target: { value: "Без объекта" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить жалобу" }));

    expect(mockMutate).not.toHaveBeenCalled();
    expect(mockToastShow).not.toHaveBeenCalled();
  });

  it("пустое описание: кнопка погашена, отправки нет", () => {
    renderForm();

    fireEvent.change(screen.getByLabelText("На что жалуетесь"), {
      target: { value: `trip:${TRIP_ID}` },
    });

    const button = screen.getByRole("button", {
      name: "Отправить жалобу",
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
