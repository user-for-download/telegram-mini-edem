import { useSyncExternalStore } from "react";

/**
 * Dev-переключатели платформы и темы для браузерного стенда
 * (по образцу tg-mini-app/lib/platform.ts): быстрые кнопки в шапке
 * принудительно задают оформление UI-кита, выбор живёт в localStorage.
 * Прод в Telegram не трогаем — кнопки видны только в dev-сборке.
 */

export type PlatformChoice = "ios" | "android";
export type AppearanceChoice = "dark" | "light";

export const PLATFORM_OPTIONS: ReadonlyArray<{
  value: PlatformChoice;
  label: string;
}> = [
  { value: "ios", label: "iOS" },
  { value: "android", label: "Android" },
];

export const APPEARANCE_OPTIONS: ReadonlyArray<{
  value: AppearanceChoice;
  label: string;
}> = [
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

const PLATFORM_KEY = "edem:dev-platform";

const listeners = new Set<() => void>();
function notify(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function isPlatformChoice(value: unknown): value is PlatformChoice {
  return value === "ios" || value === "android";
}

function readPlatform(): PlatformChoice | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(PLATFORM_KEY);
    return isPlatformChoice(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Dev-оверрайд платформы (null — следовать за клиентом). */
export function getDevPlatform(): PlatformChoice | null {
  return readPlatform();
}

export function setDevPlatform(value: PlatformChoice | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) localStorage.removeItem(PLATFORM_KEY);
    else localStorage.setItem(PLATFORM_KEY, value);
  } catch {
    // Приватный режим — настройка просто не сохранится.
  }
  notify();
}

export function useDevPlatform(): PlatformChoice | null {
  return useSyncExternalStore(subscribe, readPlatform, () => null);
}

/** Выбор пользователя → платформа AppRoot (у кита только ios/base). */
export function resolveAppRootPlatform(
  choice: PlatformChoice | null,
  fallback: "base" | "ios" = "base",
): "base" | "ios" {
  if (choice === "ios") return "ios";
  if (choice === "android") return "base";
  return fallback;
}

/** Следующий вариант по кругу — тап по быстрой кнопке в шапке. */
export function nextChoice<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T | null,
): T {
  const index =
    current === null
      ? -1
      : options.findIndex((option) => option.value === current);
  return options[(index + 1) % options.length]?.value ?? options[0].value;
}

/** Круг платформы с возвратом в «Авто»: null → ios → android → null. */
export function nextPlatformChoice(
  current: PlatformChoice | null,
): PlatformChoice | null {
  if (current === null) return "ios";
  if (current === "ios") return "android";
  return null;
}

/** Подпись текущего варианта — текст быстрой кнопки в шапке. */
export function choiceLabel<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T | null,
): string {
  if (current === null) return "Авто";
  return options.find((option) => option.value === current)?.label ?? current;
}
