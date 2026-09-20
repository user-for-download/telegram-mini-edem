import type { FC, PropsWithChildren } from "react";
import { useEffect } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import {
  miniApp,
  themeParams,
  useLaunchParams,
  useSignal,
} from "@telegram-apps/sdk-react";
import {
  setMiniAppBackgroundColor,
  setMiniAppBottomBarColor,
  setMiniAppHeaderColor,
} from "@telegram-apps/sdk-react";
import type { ThemeOverride } from "@/utils/appSettings";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthGate } from "@/components/AuthGate";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ApiError } from "@/api/client";
import { useAppSettings } from "@/utils/appSettings";
import { resolveAppRootPlatform, useDevPlatform } from "@/utils/devPlatform";
import { Onboarding } from "@/components/Onboarding";
import { ToastProvider } from "@/components/ToastProvider";
import {
  WsProvider,
  TelegramRealtimeListener,
} from "@/providers/WebSocketProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Порт из mini-app AppConfig: детерминированные ошибки и 4xx
      // (кроме 408-таймаута) не ретраим, остальное — до 3 попыток.
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if (error.code === "INVALID_RESPONSE") {
            return false;
          }
          if (
            error.status &&
            error.status >= 400 &&
            error.status < 500 &&
            error.status !== 408
          ) {
            return false;
          }
        }
        return failureCount < 3;
      },
      refetchOnWindowFocus: false,
      staleTime: 60_000,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 0,
    },
  },
});

function ErrorFallback({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : JSON.stringify(error);
  // Чистый HTML: фолбэк живёт СНАРУЖИ AppRoot, TGUI здесь упадёт
  // с «Wrap your app with <AppRoot>» и замаскирует исходную ошибку.
  return (
    <div style={{ padding: "32px 16px", textAlign: "center" }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>Что-то пошло не так</h1>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>
        <code>{message}</code>
      </p>
      <button
        type="button"
        style={{ padding: "10px 20px", fontSize: 16 }}
        onClick={() => window.location.reload()}
      >
        Обновить
      </button>
    </div>
  );
}

/** Маппинг платформы Telegram → платформа telegram-ui AppRoot.
 * AppRoot 2.1.x принимает только 'base' | 'ios': iOS — нативный вид,
 * всё остальное (Android, десктоп, веб) — нейтральный 'base'.
 * Dev-стенд может принудительно задать платформу кнопками в шапке
 * (utils/devPlatform) — оверрайд важнее клиента. */
function useTguiPlatform(): "base" | "ios" {
  const devPlatform = useDevPlatform();
  let client: "base" | "ios" = "base";
  try {
    const p = useLaunchParams().tgWebAppPlatform;
    if (p === "ios") client = "ios";
  } catch {
    // launch params недоступны (крайний случай) — нейтральный base.
  }
  return resolveAppRootPlatform(devPlatform, client);
}

/** Живая тёмная тема Telegram (miniApp.isDark) с ручным переопределением
 * из профиля («Внешний вид»): ведём и проп appearance AppRoot (палитра
 * tgui), и свой класс `dark` на documentElement (наши --app-* токены).
 *
 * Нюанс: цвета tgui берутся из --tg-theme-*, которые SDK биндит ИНЛАЙНОМ
 * один раз — смена appearance их не трогает (поэтому «менялись только
 * инпуты»). При ручном оверрайде выставляем каноническую палитру тоже
 * инлайном; при сбросе — возвращаем значения клиента из themeParams.
 * В SSR (renderToString) эффекты не выполняются. */
const THEME_VAR_NAMES = [
  "bg-color",
  "text-color",
  "hint-color",
  "link-color",
  "button-color",
  "button-text-color",
  "secondary-bg-color",
  "header-bg-color",
  "accent-text-color",
  "section-bg-color",
  "section-header-text-color",
  "subtitle-text-color",
  "destructive-text-color",
] as const;

/** Каноническая светлая палитра Telegram (совпадает с фолбэками tgui). */
const LIGHT_PALETTE: Record<(typeof THEME_VAR_NAMES)[number], string> = {
  "bg-color": "#ffffff",
  "text-color": "#000000",
  "hint-color": "#707579",
  "link-color": "#007aff",
  "button-color": "#007aff",
  "button-text-color": "#ffffff",
  "secondary-bg-color": "#efeff4",
  "header-bg-color": "#ffffff",
  "accent-text-color": "#007aff",
  "section-bg-color": "#ffffff",
  "section-header-text-color": "#707579",
  "subtitle-text-color": "#707579",
  "destructive-text-color": "#ff3b30",
};

/** Каноническая тёмная палитра Telegram (Android dark). */
const DARK_PALETTE: Record<(typeof THEME_VAR_NAMES)[number], string> = {
  "bg-color": "#17212b",
  "text-color": "#f5f5f5",
  "hint-color": "#708499",
  "link-color": "#6ab3f3",
  "button-color": "#5288c1",
  "button-text-color": "#ffffff",
  "secondary-bg-color": "#232e3c",
  "header-bg-color": "#17212b",
  "accent-text-color": "#6ab2f2",
  "section-bg-color": "#17212b",
  "section-header-text-color": "#6ab3f3",
  "subtitle-text-color": "#708499",
  "destructive-text-color": "#ec3942",
};

function applyThemeOverride(override: ThemeOverride): void {
  const root = document.documentElement;
  if (!override) {
    // Возврат к теме клиента: bindCssVars одноразовый, поэтому
    // восстанавливаем значения вручную из текущего состояния SDK.
    const state = themeParams.state() as Record<string, string | undefined>;
    for (const name of THEME_VAR_NAMES) {
      const value = state[name.replace(/-/g, "_")];
      if (value) root.style.setProperty(`--tg-theme-${name}`, value);
      else root.style.removeProperty(`--tg-theme-${name}`);
    }
    return;
  }
  const palette = override === "dark" ? DARK_PALETTE : LIGHT_PALETTE;
  for (const name of THEME_VAR_NAMES) {
    root.style.setProperty(`--tg-theme-${name}`, palette[name]);
  }
}

function useTelegramAppearance(): "dark" | "light" {
  const tgDark = useSignal(miniApp.isDark);
  const { themeOverride } = useAppSettings();
  const isDark = themeOverride ? themeOverride === "dark" : tgDark;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    applyThemeOverride(themeOverride);
    // Нативный хром Telegram в цвет приложения (официальная дока):
    // шапка и фон — bg_color, нижняя полоса — secondary_bg_color.
    setMiniAppHeaderColor.ifAvailable("bg_color");
    setMiniAppBackgroundColor.ifAvailable("bg_color");
    setMiniAppBottomBarColor.ifAvailable("secondary_bg_color");
  }, [isDark, themeOverride]);
  return isDark ? "dark" : "light";
}

export const AppConfig: FC<PropsWithChildren> = ({ children }) => {
  const platform = useTguiPlatform();
  const appearance = useTelegramAppearance();

  return (
    <QueryClientProvider client={queryClient}>
      {/* ErrorBoundary — самый внешний рубеж, fallback без UI-кита. */}
      <ErrorBoundary fallback={ErrorFallback}>
        <AppRoot platform={platform} appearance={appearance}>
          <OfflineBanner />
          <AuthGate>
            <Onboarding>
              <WsProvider>
                <TelegramRealtimeListener />
                <ToastProvider>{children}</ToastProvider>
              </WsProvider>
            </Onboarding>
          </AuthGate>
        </AppRoot>
      </ErrorBoundary>
    </QueryClientProvider>
  );
};
