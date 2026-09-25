import { type FC, type PropsWithChildren, useRef, useState } from "react";
import {
  Caption,
  Cell,
  List,
  Placeholder,
  Section,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { Button } from "@/ui/Button";

import { Handshake, Lock, Scale } from "lucide-react";
import { usersApi } from "@/api/users.api";
import { useAuthStore } from "@/store/useAuthStore";
import { ONBOARDING_VERSION } from "@/onboarding/version";
import styles from "./Onboarding.module.css";

export const Onboarding: FC<PropsWithChildren> = ({ children }) => {
  const user = useAuthStore((state) => state.user);
  const [busy, setBusy] = useState(false);
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
          "Не удалось продолжить. Проверьте интернет и попробуйте ещё раз.",
        ),
      )
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  return (
    <main className={styles.root} aria-labelledby="onboarding-title">
      <List className={styles.list}>
        <Placeholder
          header="Добро пожаловать в «Едем»"
          description="Попутчики для совместных поездок: вы находите друг друга здесь, а дальше — договариваетесь напрямую."
          className={styles.hero}
        >
          <VisuallyHidden Component="span" id="onboarding-title">
            Первый вход
          </VisuallyHidden>
        </Placeholder>
        {error && (
          <Notice tone="danger" variant="text">{error}</Notice>
        )}
        <Section
          header="Прочитайте перед началом"
          footer="Сервис доступен пользователям старше 14 лет"
          className={styles.section}
        >
          <Cell
            multiline
            before={<Handshake aria-hidden />}
            subtitle={
              <Caption level="1" weight="3">
                Вы общаетесь, договариваетесь и рассчитываетесь напрямую
                с другими пользователями — без посредников.
              </Caption>
            }
          >
            Всё на доверии
          </Cell>
          <Cell
            multiline
            before={<Scale aria-hidden />}
            subtitle={
              <Caption level="1" weight="3">
                Сервис не предоставляет юридической защиты и не несёт
                обязательств по вашим договорённостям.
              </Caption>
            }
          >
            Ответственность — на пользователях
          </Cell>
          <Cell
            multiline
            before={<Lock aria-hidden />}
            subtitle={
              <Caption level="1" weight="3">
                Только то, что нужно для поездок: профиль, маршруты и заявки.
                Переписка и расчёты проходят мимо нас.
              </Caption>
            }
          >
            Минимум данных
          </Cell>
        </Section>
        <Section
          footer="Нажимая кнопку, вы подтверждаете, что всё поняли"
          className={`${styles.section} ${styles.action}`}
        >
          <Button
            size="l"
            variant="white"
            stretched
            loading={busy}
            disabled={busy}
            onClick={accept}
            className={styles.accept}
          >
            Я понял
          </Button>
        </Section>
      </List>
    </main>
  );
};
