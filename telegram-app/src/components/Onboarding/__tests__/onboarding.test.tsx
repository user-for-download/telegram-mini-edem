// SSR-тесты Onboarding (экран согласия первого входа): ветки
// user=null / версия актуальна (дети сквозняком) / версия устарела
// (приветствие + кнопки, детей нет). Паттерн reviewsModal.test.tsx
// (SSR renderToString, без testing-library): auth-пользователь отдаётся
// моком useAuthStore напрямую — серверный снапшот zustand начальный.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ONBOARDING_VERSION } from "@/onboarding/version";
import styles from "../Onboarding.module.css";

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

// Сеть не трогаем: accept/delete вызываются только по клику,
// но реальный модуль API в SSR не нужен.
vi.mock("@/api/users.api", () => ({
  usersApi: {
    completeOnboarding: vi.fn(),
    deleteCurrentUser: vi.fn(),
  },
}));

import { Onboarding } from "@/components/Onboarding/Onboarding";

function render(element: ReactNode): string {
  return renderToString(<AppRoot platform="base">{element}</AppRoot>);
}

beforeEach(() => {
  authState.user = null;
});

describe("Onboarding", () => {
  it("без пользователя — дети сквозняком, приветствия нет", () => {
    const html = render(
      <Onboarding>
        <span>Лента</span>
      </Onboarding>,
    );
    expect(html).toContain("Лента");
    expect(html).not.toContain("Добро пожаловать");
  });

  it("версия актуальна — дети сквозняком, приветствия нет", () => {
    authState.user = { onboardingVersion: ONBOARDING_VERSION };
    const html = render(
      <Onboarding>
        <span>Лента</span>
      </Onboarding>,
    );
    expect(html).toContain("Лента");
    expect(html).not.toContain("Добро пожаловать");
  });

  it("версия устарела — приветствие и дисклеймер, детей нет", () => {
    authState.user = { onboardingVersion: "2" };
    const html = render(
      <Onboarding>
        <span>Лента</span>
      </Onboarding>,
    );
    expect(html).toContain("Добро пожаловать");
    expect(html).toContain("Всё на доверии");
    expect(html).toContain("Ответственность — на пользователях");
    expect(html).toContain("Минимум данных");
    expect(html).toContain("Я понял");
    expect(html).toContain(styles.accept);
    expect(html).not.toContain("Лента");
  });

  it("согласие не завершено (null) — приветствие", () => {
    authState.user = { onboardingVersion: null };
    const html = render(
      <Onboarding>
        <span>Лента</span>
      </Onboarding>,
    );
    expect(html).toContain("Добро пожаловать");
    expect(html).toContain("Я понял");
  });
});
