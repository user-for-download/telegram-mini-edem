import type { FC, PropsWithChildren } from "react";
import { useEffect } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { miniApp, useLaunchParams, useSignal } from "@telegram-apps/sdk-react";
import {
  setMiniAppBackgroundColor,
  setMiniAppBottomBarColor,
  setMiniAppHeaderColor,
} from "@telegram-apps/sdk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthGate } from "@/components/AuthGate";
import { OfflineBanner } from "@/components/OfflineBanner";
import { ApiError } from "@/api/client";
import { useAppSettings } from "@/utils/appSettings";
import { Onboarding } from "@/components/Onboarding";
import { ToastProvider } from "@/components/ToastProvider";
import { WsProvider, TelegramRealtimeListener } from "@/providers/WebSocketProvider";

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
  return (
    <div className="RootError">
      <div className="RootError__content">
        <p>Что-то пошло не так:</p>
        <blockquote>
          <code>
            {error instanceof Error
              ? error.message
              : typeof error === "string"
                ? error
                : JSON.stringify(error)}
          </code>
        </blockquote>
        <button type="button" onClick={() => window.location.reload()}>
          Обновить
        </button>
      </div>
    </div>
  );
}

/** Маппинг платформы Telegram → платформа telegram-ui AppRoot.
 * AppRoot 2.1.x принимает только 'base' | 'ios': iOS — нативный вид,
 * всё остальное (Android, десктоп, веб) — нейтральный 'base'. */
function useTguiPlatform(): "base" | "ios" {
  let platform: "base" | "ios" = "base";
  try {
    const p = useLaunchParams().tgWebAppPlatform;
    if (p === "ios") platform = "ios";
  } catch {
    // launch params недоступны (крайний случай) — нейтральный base.
  }
  return platform;
}

/** Живая тёмная тема Telegram (miniApp.isDark) с ручным переопределением
 * из профиля («Внешний вид»): ведём и проп appearance AppRoot (палитра
 * tgui), и свой класс `dark` на documentElement (наши --app-* токены).
 * В SSR (renderToString) эффекты не выполняются. */
function useTelegramAppearance(): "dark" | "light" {
  const tgDark = useSignal(miniApp.isDark);
  const { themeOverride } = useAppSettings();
  const isDark = themeOverride ? themeOverride === "dark" : tgDark;
  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
    // Нативный хром Telegram в цвет приложения (официальная дока):
    // шапка и фон — bg_color, нижняя полоса — secondary_bg_color.
    setMiniAppHeaderColor.ifAvailable("bg_color");
    setMiniAppBackgroundColor.ifAvailable("bg_color");
    setMiniAppBottomBarColor.ifAvailable("secondary_bg_color");
  }, [isDark]);
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
          <AuthGate><Onboarding><WsProvider><TelegramRealtimeListener /><ToastProvider>{children}</ToastProvider></WsProvider></Onboarding></AuthGate>
        </AppRoot>
      </ErrorBoundary>
    </QueryClientProvider>
  );
};
