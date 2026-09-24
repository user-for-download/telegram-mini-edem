import { type FC, type PropsWithChildren, useRef, useState } from "react";
import {
  Caption,
  Cell,
  List,
  Placeholder,
  Section,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Stack } from "@/ui/Stack";
import { Notice } from "@/ui/Notice";
import { Button } from "@/ui/Button";

import { ChevronRight } from "lucide-react";
import { usersApi } from "@/api/users.api";
import { useAuthStore } from "@/store/useAuthStore";
import { ONBOARDING_VERSION } from "@/onboarding/version";
import styles from "./Onboarding.module.css";

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
          <Notice tone="danger" variant="text">{error}</Notice>
        )}
        <Placeholder
          header="Без согласия сервис недоступен"
          description="Для поиска попутчиков нужно принять условия. Можно вернуться к документам или удалить созданный профиль."
          action={
            <>
              <Button
                size="l"
                stretched
                onClick={() => setDeclined(false)}
              >
                Вернуться
              </Button>
              <Button
                size="l"
                variant="outline"
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
    <main className={styles.root} aria-labelledby="onboarding-title">
      <List className={styles.list}>
        <Placeholder
          header="Добро пожаловать в «Едем»"
          description="Сервис поиска попутчиков для совместных поездок. Вы общаетесь и рассчитываетесь напрямую с другими пользователями."
        >
          <VisuallyHidden Component="span" id="onboarding-title">
            Первый вход
          </VisuallyHidden>
        </Placeholder>
        {error && (
          <Notice tone="danger" variant="text">{error}</Notice>
        )}
        <Section
          header="Перед началом"
          footer="Сервис доступен пользователям старше 14 лет. Нажимая кнопку, вы принимаете оба документа"
        >
          <Cell
            multiline
            subtitle={
              <Caption level="1" weight="3">
                Обработка данных о поездках
              </Caption>
            }
            after={<ChevronRight />}
          >
            Пользовательское соглашение
          </Cell>
          <Cell
            multiline
            subtitle={
              <Caption level="1" weight="3">
                Как мы храним и используем ваши данные
              </Caption>
            }
            after={<ChevronRight />}
          >
            Политика конфиденциальности
          </Cell>

          <Stack
            style={{ gap: 8 }}
          >
            <Button
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
              variant="ghost"
              stretched
              className={styles.decline}
              disabled={busy}
              onClick={() => setDeclined(true)}
            >
              Отклонить
            </Button>
          </Stack>
        </Section>
      </List>
    </main>
  );
};
