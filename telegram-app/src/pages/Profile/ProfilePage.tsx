import { useState, type ReactNode } from "react";
import {
  Avatar,
  Badge,
  Caption,
  Headline,
  IconContainer,
  Switch,
  Text,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Cell } from "@/ui/Cell";

import {
  Bell,
  Car,
  ChevronRight,
  ClipboardList,
  Flag,
  History,
  Moon,
  Star,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { miniApp, useSignal } from "@tma.js/sdk-react";
import { useNavigate } from "react-router-dom";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { QueryState } from "@/components/QueryState";
import { MutationError } from "@/components/MutationError";
import { FeedbackModal } from "@/components/Profile/FeedbackModal";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Section } from "@/ui/Section";
import { Stack } from "@/ui/Stack";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { GROW, INFO, PROSE_TEXT, TRUNCATE } from "@/ui/classes";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { isAccountDeletedError, ApiError } from "@/api/client";
import {
  useDeleteAccountMutation,
  useProfileNotificationSettingsMutation,
  useProfileQuery,
} from "@/queries/profile";
import {
  setSoundEnabled,
  setThemeOverride,
  useAppSettings,
} from "@/utils/appSettings";
import { haptic } from "@/utils/haptics";
import { useModalBack } from "@/utils/modalBack";
import styles from "./ProfilePage.module.css";

/** Обрезка в одну строку + блочный display (span/caption-типографика tgui).
 * ellipsis-рецепт — канонный TRUNCATE из @/ui/classes, block — локальный. */
const TRUNCATE_BLOCK = `${TRUNCATE} ${styles.truncateBlock}`;



/**
 * Каскад удаления аккаунта — юридический текст в одном месте.
 * Здесь только хвост — префикс «Аккаунт будет анонимизирован.»
 * нужен лишь в диалоге.
 */
const DELETE_ACCOUNT_WARNING =
  "Ваши активные поездки завершатся (ожидающие заявки отклонятся, " +
  "подтверждённые останутся историей), ваши брони на чужих поездках " +
  "и заявки на поездку отменятся. Восстановление невозможно.";

/**
 * Строка меню раздела — tgui Cell (учебниковый паттерн стори Playground:
 * before=иконка, children=title, subtitle, after=chevron). Cell идёт через
 * Tappable (ripple/press), Component="button" + styles.menuCell держат ширину.
 */
function MenuRow({
  icon,
  title,
  subtitle,
  onClick,
  label,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
  label: string;
}) {
  return (
    <Cell
      Component="button"
      type="button"
      // Имя = заголовок + подпись: видимая подпись входит в имя.
      aria-label={`${label}. ${subtitle}`}
      onClick={onClick}
      before={<span className={styles.icon}>{icon}</span>}
      after={<ChevronRight size={16} className={styles.chevron} />}
      subtitle={subtitle}
      className={styles.menuCell}
    >
      {title}
    </Cell>
  );
}

/**
 * Строка-переключатель: обычная `Cell`, `Switch` в слоте `after`.
 *
 * Поверхность и разделители между строками даёт `Section` — свои рамки и
 * `Stack`-обёртка не нужны (и ломали разделители: `Section` ставит `Divider`
 * только между прямыми детьми).
 *
 * Строка не кликабельна целиком: нативный `Switch` внутри `<button>` —
 * невалидная вложенность и двойное срабатывание на Enter/Space.
 */
function SwitchRow({
  icon,
  title,
  subtitle,
  checked,
  onChange,
  label,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <Cell
      before={icon}
      subtitle={subtitle}
      after={
        <Switch
          // Настройка вкл/выкл — это switch по APG, а не чекбокс:
          // скринридер озвучивает «включено/выключено». aria-checked
          // руками не задаём: браузер выводит его из checked, а
          // дублирование рискует разойтись с реальным состоянием.
          role="switch"
          aria-label={label}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
      }
    >
      {title}
    </Cell>
  );
}

/**
 * Профиль Telegram-пользователя (язык ProfileTab примера): header-карточка
 * с рейтингом и статистикой и плоский список секций-разделов.
 *
 * Отзывов здесь больше нет: они уехали в отдельную страницу `/reviews`
 * (`pages/Reviews/ReviewsPage.tsx`) и открываются пунктом меню. До этого
 * экран держал субтабы «Настройки и авто / «Отзывы», а список «Обо мне»
 * дублировался ещё и в edge-шторке /reviews.
 *
 * Просмотр/редактирование имени и «О себе», переходы в разделы,
 * удаление аккаунта каскадом через ConfirmPopup (нативный алерт клиента).
 * Бэкенд DELETE /me никогда не отвечает 409: свои active-поездки
 * принудительно завершаются, брони и заявки отменяются (см. футер
 * «Опасной зоны»). Кнопки «Выйти» нет — только удаление, как Delete
 * My Account официалки. Бан/удаление mid-session: requireUser отвечает
 * 403 — показываем терминальные экраны вместо общей ошибки.
 */
export function ProfilePage() {
  const navigate = useNavigate();
  const profile = useProfileQuery();
  const remove = useDeleteAccountMutation();
  const saveNotifications = useProfileNotificationSettingsMutation();
  const { themeOverride, soundEnabled } = useAppSettings();
  const tgDark = useSignal(miniApp.isDark);
  const dark = themeOverride ? themeOverride === "dark" : tgDark;
  const [notifEnabled, setNotifEnabled] = useState<boolean | null>(null);
  const notifChecked =
    notifEnabled ?? profile.data?.notificationsEnabled ?? true;

  // Один флаг бэкенда на оба канала: тогглы in-app и Telegram — зеркала.
  const toggleNotifications = (next: boolean) => {
    if (saveNotifications.isPending) return;
    const previous = notifChecked;
    haptic.light();
    setNotifEnabled(next);
    saveNotifications.mutate(next, {
      onSuccess: () => haptic.success(),
      onError: () => {
        haptic.error();
        setNotifEnabled(previous);
      },
    });
  };
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // State-модалка перехватывает Back первой (стек modalBack в Shell).
  useModalBack(() => setFeedbackOpen(false), feedbackOpen);

  // Удаление — через ConfirmPopup (нативный алерт клиента):
  // нативный window.confirm ненадёжен в Telegram WebView.

  if (profile.error instanceof ApiError && profile.error.status === 403) {
    if (isAccountDeletedError(profile.error)) {
      return (
        <AccountStatePage
          title="Профиль удалён"
          description="Аккаунт анонимизирован. Поездки и отзывы сохранены без вашего имени. Восстановление невозможно."
        />
      );
    }
    return (
      <AccountStatePage
        title="Аккаунт заблокирован"
        description="Действие недоступно: аккаунт заблокирован. Обжалование пока недоступно в Telegram."
      />
    );
  }

  return (
    <>
      <QueryState
        loading={profile.isLoading}
        error={profile.error}
        empty={!profile.data}
        emptyText={EMPTY_STATES.profileEmpty.description}
        onRetry={() => void profile.refetch()}
      >
        {profile.data && (
          <Page>
            {/* NavHeader помечен aria-hidden («авторитетные h1 живут на
                страницах»), поэтому имя экрана даёт скрытый h1, а заголовки
                секций — h2 (гарантирует фасад ui/Section). */}
            <VisuallyHidden Component="h1">Профиль</VisuallyHidden>
            {/* Шапка профиля: поверхность — Section без заголовка. */}
            <Section>
              <SectionBody>
                <div className={styles.headerRow}>
                  <Avatar
                    size={48}
                    src={profile.data.avatar}
                    acronym={(profile.data.name ?? "П")
                      .slice(0, 2)
                      .toUpperCase()}
                  />
                  <div className={GROW}>
                    <Headline weight="2" className={TRUNCATE_BLOCK}>
                      {profile.data.name}
                    </Headline>
                    <div className={styles.ratingRow}>
                      <Badge type="number" mode="secondary" large>
                        <Star size={11} />
                        <span>{`${profile.data.rating.toFixed(1)}`}</span>
                      </Badge>
                    </div>
                  </div>
                </div>

                {profile.data.about && (
                  <Text Component="p" className={PROSE_TEXT}>
                    {profile.data.about}
                  </Text>
                )}

                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <Text weight="2" Component="div">
                      {profile.data.tripsCount}
                    </Text>
                    <Caption Component="div" className={styles.statLabel}>
                      Поездок
                    </Caption>
                  </div>
                  <div className={styles.stat}>
                    <Text weight="2" Component="div" className={INFO}>
                      {profile.data.reviewsCount}
                    </Text>
                    <Caption Component="div" className={styles.statLabel}>
                      Отзывов
                    </Caption>
                  </div>
                  <div className={styles.stat}>
                    <Text
                      weight="2"
                      Component="div"
                      className={styles.statRating}
                    >
                      {profile.data.rating.toFixed(1)}
                    </Text>
                    <Caption Component="div" className={styles.statLabel}>
                      Рейтинг
                    </Caption>
                  </div>
                </div>

                <Button
                  stretched
                  size="s"
                  onClick={() => {
                    haptic.light();
                    navigate("/profile/edit");
                  }}
                >
                  Редактировать профиль
                </Button>
              </SectionBody>
            </Section>

            <Stack>
                <Section header="Мои поездки">
                  <MenuRow
                    label="История поездок"
                    icon={
                      <IconContainer>
                        <History size={18} />
                      </IconContainer>
                    }
                    title="История поездок"
                    subtitle="Завершённые и отменённые поездки"
                    onClick={() => {
                      haptic.light();
                      navigate("/profile/history");
                    }}
                  />
                  {/* Заявки на попутку — отдельная страница /profile/ride-requests.
                      Список заявок (статусы, пауза, отмена) — это
                      управление сущностью, ему нужна страница, а не
                      всплывающее окно; создание заявки живёт в окне. */}
                  <MenuRow
                    label="История запросов"
                    icon={
                      <IconContainer>
                        <ClipboardList size={18} />
                      </IconContainer>
                    }
                    title="История запросов"
                    subtitle="Мои заявки на попутку"
                    onClick={() => {
                      haptic.light();
                      navigate("/profile/ride-requests");
                    }}
                  />
                  {/* Отзывы — отдельная страница /reviews (свои вкладки
                      «Мои / Новая / Обо мне»). */}
                  <MenuRow
                    label="Отзывы"
                    icon={
                      <IconContainer>
                        <Star size={18} />
                      </IconContainer>
                    }
                    title="Отзывы"
                    subtitle={`Мои отзывы и отзывы обо мне · ${profile.data.reviewsCount}`}
                    onClick={() => {
                      haptic.light();
                      navigate("/reviews");
                    }}
                  />
                </Section>
                <Section header="Мой автомобиль (для поездок)">
                  <MenuRow
                    label={
                      profile.data.car ? "Автомобиль" : "Добавить автомобиль"
                    }
                    icon={
                      <IconContainer>
                        <Car size={18} />
                      </IconContainer>
                    }
                    title={
                      profile.data.car ? "Автомобиль" : "Добавить автомобиль"
                    }
                    subtitle={
                      profile.data.car
                        ? `${profile.data.car.model} · ${profile.data.car.color}`
                        : "Добавьте автомобиль, чтобы создавать поездки"
                    }
                    onClick={() => navigate("/vehicle")}
                  />
                </Section>
                <Section header="Внешний вид">
                  <SwitchRow
                    label="Тёмная тема"
                    icon={
                      <IconContainer>
                        <Moon size={18} />
                      </IconContainer>
                    }
                    title="Тёмная тема"
                    subtitle={
                      dark
                        ? `Включена тёмная тема${themeOverride ? "" : " (как в Telegram)"}`
                        : `Включена светлая тема${themeOverride ? "" : " (как в Telegram)"}`
                    }
                    checked={dark}
                    onChange={(next) => {
                      setThemeOverride(next ? "dark" : "light");
                      haptic.light();
                    }}
                  />
                </Section>
                <Section header="Уведомления и звуки">
                  {/* Ошибка сохранения настроек — видимая, через MutationError. */}
                  <MutationError
                    error={saveNotifications.error}
                    fallback="Не удалось сохранить настройки уведомлений"
                  />
                  <SwitchRow
                    label="Уведомления"
                    icon={
                      <IconContainer>
                        <Bell size={18} />
                      </IconContainer>
                    }
                    title="Уведомления"
                    subtitle="Брони, статусы поездок, ответы поддержки"
                    checked={notifChecked}
                    onChange={toggleNotifications}
                  />
                  <SwitchRow
                    label="Звуковые эффекты"
                    icon={
                      <IconContainer>
                        <Volume2 size={18} />
                      </IconContainer>
                    }
                    title="Звуковые эффекты"
                    subtitle="Звуковые сигналы и вибрация"
                    checked={soundEnabled}
                    onChange={(next) => {
                      setSoundEnabled(next);
                      if (next) haptic.light();
                    }}
                  />
                </Section>
                <Section header="Сервис и помощь">
                  <MenuRow
                    label="Служба поддержки"
                    icon={
                      <IconContainer>
                        <TriangleAlert size={18} />
                      </IconContainer>
                    }
                    title="Служба поддержки"
                    subtitle="Вопросы и обращения — ответим в течение нескольких минут"
                    onClick={() => {
                      haptic.light();
                      setFeedbackOpen(true);
                    }}
                  />
                  <MenuRow
                    label="Жалобы"
                    icon={
                      <IconContainer>
                        <Flag size={18} />
                      </IconContainer>
                    }
                    title="Жалобы"
                    subtitle="Сообщить о проблеме с пользователем"
                    onClick={() => navigate("/profile/reports")}
                  />
                </Section>
                {/* Опасная зона — как Add Account официалки: секция,
                    в ней красная надпись-кнопка, описание — в футере
                    секции. Кнопки «Выйти» нет. */}
                <Section
                  header="Опасная зона"
                  footer={DELETE_ACCOUNT_WARNING}
                >
                  <MutationError
                    error={remove.error}
                    fallback="Не удалось удалить профиль"
                  />
                  <ConfirmPopup
                    label="Удалить профиль"
                    confirmLabel="Удалить окончательно"
                    description={`Аккаунт будет анонимизирован. ${DELETE_ACCOUNT_WARNING}`}
                    pending={remove.isPending}
                    disabled={remove.isPending}
                    mode="plain"
                    destructive
                    onConfirm={() => remove.mutate()}
                  />
                </Section>
              </Stack>
          </Page>
        )}
      </QueryState>
      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
      />
    </>
  );
}
