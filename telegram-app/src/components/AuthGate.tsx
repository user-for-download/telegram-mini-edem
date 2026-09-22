import { type FC, type PropsWithChildren, useEffect, useState } from "react";
import { Button, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { useAuthStore } from "@/store/useAuthStore";
import { apiClient } from "@/api/client";
import { AccountStatePage, RetryAction } from "@/pages/AccountStatePage/AccountStatePage";
import { AppealForm } from "@/components/AppealForm";

// Пауза перед повторной попыткой после 429: каждое нажатие «Попробовать
// снова» — это новый POST /auth/telegram, который продлевает rate-limit окно
// (5 попыток на 5 минут, bucket общий для DEV-стенда через Vite-прокси).
const RATE_LIMIT_COOLDOWN_S = 60;

/**
 * Гейт авторизации (порт mini-app AuthGate на telegram-ui).
 * Запускает bootstrap при первом рендере, показывает спиннер до завершения,
 * терминирующие экраны для бана/удаления/ошибки, подписывается на события
 * apiClient (silent refresh, session expired, banned) и сворачивание WebView.
 */
export const AuthGate: FC<PropsWithChildren> = ({ children }) => {
  const status = useAuthStore((state) => state.status);
  const bootstrap = useAuthStore((state) => state.bootstrap);
  const banReason = useAuthStore((state) => state.banReason);
  const lastAuthError = useAuthStore((state) => state.lastAuthError);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  const isRateLimited =
    lastAuthError?.status === 429 || lastAuthError?.code === "RATE_LIMITED";

  // При 429 запускаем cooldown, чтобы пользователь не продлевал блокировку
  // повторными нажатиями: каждое нажатие = новый запрос в тот же bucket.
  useEffect(() => {
    if (!isRateLimited) {
      setCooldownLeft(0);
      return;
    }
    setCooldownLeft(RATE_LIMIT_COOLDOWN_S);
    const timer = setInterval(() => {
      setCooldownLeft((left) => {
        if (left <= 1) {
          clearInterval(timer);
          return 0;
        }
        return left - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRateLimited, status]);

  useEffect(() => {
    if (status === "idle") {
      void bootstrap();
    }
  }, [status, bootstrap]);

  /**
   * Подписка на тихое обновление токенов в apiClient (silent refresh по 401).
   * Без этого Zustand-стор хранит отозванный refresh-токен, и ручной
   * refreshSession() (возврат из фона) приводит к ложному логауту.
   */
  useEffect(() => {
    return apiClient.onTokenUpdate((tokens) => {
      const state = useAuthStore.getState();
      // Не воскрешаем сессию, если пользователь вышел (clearSession),
      // удалил аккаунт или авторизация в состоянии ошибки — refresh мог
      // стартовать ДО логаута.
      if (
        state.status === "unauthenticated" ||
        state.status === "error" ||
        state.status === "deleted"
      ) {
        return;
      }
      useAuthStore.setState({
        status: "authenticated",
        session: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: Date.now() + tokens.expiresIn * 1000,
        },
      });
    });
  }, []);

  /**
   * Refresh-токен отозван/истёк (401 от /auth/refresh): сбрасываем сессию,
   * чтобы приложение не застревало с мёртвыми токенами.
   */
  useEffect(() => {
    return apiClient.onSessionExpired(() => {
      const state = useAuthStore.getState();
      if (state.status === "authenticated" || state.status === "background") {
        void state.clearSession("Session expired");
      }
    });
  }, []);

  /**
   * Бан обнаружен во время активной сессии (403 FORBIDDEN от /auth/refresh).
   * Сразу выставляем status="banned" — иначе пользователь останется в
   * «Ошибка авторизации» и не увидит причину.
   */
  useEffect(() => {
    return apiClient.onBanned((reason) => {
      useAuthStore.setState({
        status: "banned",
        user: null,
        session: null,
        banReason: reason ?? null,
      });
    });
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      useAuthStore
        .getState()
        .handleBackgroundState(document.visibilityState === "hidden");
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  if (status === "idle" || status === "initializing") {
    return <Spinner size="l" />;
  }

  if (status === "banned") {
    // Обжалование с экрана бана (порт mini-app «Обратная связь»):
    // токена нет, отправка идёт через публичный POST /feedback/appeal
    // с raw initData из стора (submitSupportFeedback маршрутизирует сам).
    return (
      <>
        <AccountStatePage
          title="Аккаунт заблокирован"
          description={`Причина: ${banReason || "Причина не указана"}. Вы можете обжаловать блокировку ниже — обращение уйдёт в поддержку без входа в аккаунт.`}
        />
        <Section header="Обжалование блокировки">
          <div className="flex flex-col gap-3 p-4">
            <AppealForm />
          </div>
        </Section>
      </>
    );
  }

  if (status === "deleted") {
    return (
      <AccountStatePage
        title="Профиль удалён"
        description="Аккаунт анонимизирован. Поездки и отзывы сохранены без вашего имени. Восстановление невозможно."
      />
    );
  }

  if (status === "error" || status === "unauthenticated") {
    if (isRateLimited) {
      return (
        <Placeholder
          header="Слишком много попыток входа"
          description="Сервер временно ограничил вход (защита от перебора). Подождите немного и попробуйте один раз — повторные нажатия продлевают блокировку."
          action={
            <Button
              mode="bezeled"
              size="l"
              stretched
              disabled={cooldownLeft > 0}
              onClick={() => void bootstrap()}
            >
              {cooldownLeft > 0
                ? `Подождите ${cooldownLeft} с`
                : "Попробовать снова"}
            </Button>
          }
        />
      );
    }
    if (lastAuthError?.code === "SESSION_EXPIRED") {
      return (
        <AccountStatePage
          title="Сессия завершилась"
          description="Для безопасности нужно заново подтвердить вход через Telegram."
          action={
            <RetryAction label="Войти снова" onClick={() => void bootstrap()} />
          }
        />
      );
    }
    if (lastAuthError?.code === "INIT_DATA_UNAVAILABLE") {
      return (
        <AccountStatePage
          title="Не удалось получить данные Telegram"
          description="Откройте мини-приложение из Telegram и попробуйте снова. Не вводите initData вручную."
          action={
            <RetryAction
              label="Попробовать снова"
              onClick={() => void bootstrap()}
            />
          }
        />
      );
    }
    return (
      <Placeholder
        header="Ошибка авторизации"
        description="Не удалось проверить данные авторизации. Проверьте подключение к интернету."
        action={
          <Button
            mode="bezeled"
            size="l"
            stretched
            onClick={() => void bootstrap()}
          >
            Попробовать снова
          </Button>
        }
      />
    );
  }

  return <>{children}</>;
};
