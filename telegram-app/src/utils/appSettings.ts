import { useSyncExternalStore } from "react";

/**
 * Локальные настройки приложения (язык ProfileTab эталона):
 * переопределение темы и звук/вибрация. SSR-safe (localStorage
 * может отсутствовать), реактивность через подписку.
 */
export type ThemeOverride = "dark" | "light" | null;

const THEME_KEY = "edem:theme-override";
const SOUND_KEY = "edem:sound-enabled";

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

function readStorage(key: string): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Приватный режим и т.п. — настройка просто не сохранится.
  }
  notify();
}

function readTheme(): ThemeOverride {
  const raw = readStorage(THEME_KEY);
  return raw === "dark" || raw === "light" ? raw : null;
}

function readSound(): boolean {
  return readStorage(SOUND_KEY) !== "0";
}

export function getThemeOverride(): ThemeOverride {
  return readTheme();
}

export function setThemeOverride(value: ThemeOverride): void {
  writeStorage(THEME_KEY, value);
}

/** Звук и вибрация включены (default true). */
export function isSoundEnabled(): boolean {
  return readSound();
}

export function setSoundEnabled(enabled: boolean): void {
  writeStorage(SOUND_KEY, enabled ? "1" : "0");
}

export function useAppSettings(): { themeOverride: ThemeOverride; soundEnabled: boolean } {
  const themeOverride = useSyncExternalStore(subscribe, readTheme, () => null);
  const soundEnabled = useSyncExternalStore(subscribe, readSound, () => true);
  return { themeOverride, soundEnabled };
}
