import { type FC, type PropsWithChildren, useRef, useState } from "react";
import {
  Button,
  Caption,
  Cell,
  List,
  Placeholder,
  Section,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { usersApi } from "@/api/users.api";
import { useAuthStore } from "@/store/useAuthStore";
import { ONBOARDING_VERSION } from "@/onboarding/version";

export const Onboarding: FC<PropsWithChildren> = ({ children }) => {
  const user = useAuthStore((state) => state.user);
  const [declined, setDeclined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  if (!user || user.onboardingVersion === ONBOARDING_VERSION)
    return <>{children}</>;

  const accept = () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    void usersApi
      .completeOnboarding(ONBOARDING_VERSION)
      .then((updated) => useAuthStore.setState({ user: updated }))
      .catch(() =>
        setError(
          "Не удалось сохранить согласие. Проверьте интернет и попробуйте ещё раз.",
        ),
      )
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  if (declined) {
    return (
      <>
        {error && (
          <Caption
            Component="p"
            role="alert"
            className="text-(--tg-theme-destructive-text-color)"
          >
            {error}
          </Caption>
        )}
        <Placeholder
          header="Без согласия сервис недоступен"
          description="Для поиска попутчиков нужно принять условия. Можно вернуться к документам или удалить созданный профиль."
          action={
            <>
              <Button
                mode="bezeled"
                size="l"
                stretched
                onClick={() => setDeclined(false)}
              >
                Вернуться
              </Button>
              <Button
                size="l"
                mode="outline"
                stretched
                loading={deleting}
                disabled={deleting}
                onClick={() => {
                  if (busyRef.current) return;
                  busyRef.current = true;
                  setDeleting(true);
                  setError(null);
                  void usersApi
                    .deleteCurrentUser()
                    .then(() => useAuthStore.getState().markAccountDeleted())
                    .catch(() =>
                      setError(
                        "Не удалось удалить данные. Завершите активные поездки и попробуйте ещё раз.",
                      ),
                    )
                    .finally(() => {
                      busyRef.current = false;
                      setDeleting(false);
                    });
                }}
              >
                Удалить мои данные
              </Button>
            </>
          }
        />
      </>
    );
  }

  return (
    <main className="Onboarding" aria-labelledby="onboarding-title">
      <Placeholder
        header="Добро пожаловать в «Едем»"
        description="Сервис поиска попутчиков для совместных поездок. Вы общаетесь и рассчитываетесь напрямую с другими пользователями."
      >
        <VisuallyHidden Component="span" id="onboarding-title">
          Первый вход
        </VisuallyHidden>
      </Placeholder>
      {error && (
        <Caption
          Component="p"
          role="alert"
          className="text-(--tg-theme-destructive-text-color)"
        >
          {error}
        </Caption>
      )}
      <Section
        header="Перед началом"
        footer={
          <div className="flex flex-col gap-2">
            <Button
              mode="bezeled"
              size="l"
              stretched
              loading={busy}
              disabled={busy}
              onClick={accept}
            >
              Принять и продолжить
            </Button>
            <Button
              size="l"
              mode="plain"
              stretched
              disabled={busy}
              onClick={() => setDeclined(true)}
            >
              Не принимать
            </Button>
          </div>
        }
      >
        <List>
          <Cell
            multiline
            subtitle="Обработка имени, аватара и данных о поездках для работы сервиса"
          >
            Пользовательское соглашение
          </Cell>
          <Cell multiline subtitle="Как мы храним и используем ваши данные">
            Политика конфиденциальности
          </Cell>
        </List>
        <Caption Component="p">
          Сервис доступен пользователям старше 14 лет. Нажимая кнопку, вы
          принимаете оба документа.
        </Caption>
      </Section>
    </main>
  );
};
