import { useMemo, useState, type ReactNode } from "react";
import {
  Avatar,
  Badge,
  Button,
  Caption,
  Cell,
  Headline,
  IconContainer,
  Placeholder,
  Section,
  SegmentedControl,
  Switch,
  Text,
} from "@telegram-apps/telegram-ui";
import {
  Bell,
  Car,
  ChevronRight,
  Flag,
  History,
  Moon,
  Star,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { miniApp, useSignal } from "@telegram-apps/sdk-react";
import { useNavigate } from "react-router-dom";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { QueryState } from "@/components/QueryState";
import { ReviewCard } from "@/components/ReviewCard/ReviewCard";
import { FeedbackModal } from "@/components/Profile/FeedbackModal";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Stack } from "@/ui/Stack";
import { ApiError } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import {
  useDeleteAccountMutation,
  useProfileNotificationSettingsMutation,
  useProfileQuery,
} from "@/queries/profile";
import { useUserReviewsInfiniteQuery } from "@/queries/useReviewsQuery";
import {
  setSoundEnabled,
  setThemeOverride,
  useAppSettings,
} from "@/utils/appSettings";
import { haptic } from "@/utils/haptics";
import { useModalBack } from "@/utils/modalBack";
import styles from "./ProfilePage.module.css";

type ProfileSubtab = "settings" | "reviews";

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
      aria-label={label}
      onClick={onClick}
      before={<span className={styles.icon}>{icon}</span>}
      after={
        <ChevronRight
          size={16}
          className={styles.chevron}
        />
      }
      subtitle={subtitle}
      className={styles.menuCell}
    >
      {title}
    </Cell>
  );
}

/**
 * Строка-переключатель (язык ProfileTab эталона): обычный div,
 * не кнопка — внутри интерактивный Switch. tgui Switch = checkbox.
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
    <div className={styles.switchRow}>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.flexText}>
        <Text Component="span" className={styles.truncate}>
          {title}
        </Text>
        <Caption Component="span" className={styles.truncate}>
          {subtitle}
        </Caption>
      </span>
      <Switch
        aria-label={label}
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </div>
  );
}

/**
 * Профиль Telegram-пользователя (язык ProfileTab примера): header-карточка
 * с рейтингом и статистикой, субтабы «Настройки и авто» / «Отзывы».
 *
 * Просмотр/редактирование имени и «О себе», переходы в разделы,
 * удаление аккаунта (нативный алерт, обработка активных обязательств
 * 409). Кнопки «Выйти» нет — только удаление, как Delete My Account
 * официалки. Бан/удаление mid-session: requireUser отвечает 403 —
 * показываем терминальные экраны вместо общей ошибки.
 */
export function ProfilePage() {
  const navigate = useNavigate();
  const me = useAuthStore((state) => state.user);
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
  const aboutReviews = useUserReviewsInfiniteQuery(me?.id ?? "", 20);

  const [subtab, setSubtab] = useState<ProfileSubtab>("settings");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // State-модалка перехватывает Back первой (стек modalBack в Shell).
  useModalBack(() => setFeedbackOpen(false), feedbackOpen);

  const aboutItems = useMemo(
    () => aboutReviews.data?.pages.flatMap((page) => page.items) ?? [],
    [aboutReviews.data],
  );

  // Удаление — через ConfirmPopup (нативный алерт клиента):
  // нативный window.confirm ненадёжен в Telegram WebView.

  if (profile.error instanceof ApiError && profile.error.status === 403) {
    if (profile.error.message === "Account is deleted") {
      return (
        <Page>
        <Placeholder
          header="Профиль удалён"
          description="Аккаунт анонимизирован. Поездки и отзывы сохранены без вашего имени. Восстановление невозможно."
        />
        </Page>
      );
    }
    return (
      <Page>
      <Placeholder
        header="Аккаунт заблокирован"
        description="Действие недоступно: аккаунт заблокирован. Обжалование пока недоступно в Telegram."
      />
      </Page>
    );
  }

  const pickSubtab = (next: ProfileSubtab) => {
    if (next === subtab) return;
    haptic.selection();
    setSubtab(next);
  };

  return (
    <>
      <QueryState
        loading={profile.isLoading}
        error={profile.error}
        empty={!profile.data}
        emptyText="Не удалось загрузить профиль."
        onRetry={() => void profile.refetch()}
      >
        {profile.data && (
          <Page>
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
                  <div className={styles.flexText}>
                    <Headline weight="2" className={styles.truncate}>
                      {profile.data.name}
                    </Headline>
                    <div className={styles.ratingRow}>
                      <Badge type="number" mode="secondary" large>
                        <Star size={11} />
                        <span>{`${profile.data.rating.toFixed(1)} (${profile.data.reviewsCount})`}</span>
                      </Badge>
                      <Caption weight="2" className={styles.verified}>
                        Telegram верифицирован
                      </Caption>
                    </div>
                  </div>
                </div>

                {profile.data.about && (
                  <Text
                    Component="p"
                    className={styles.about}
                  >
                    {profile.data.about}
                  </Text>
                )}

                <div className={styles.stats}>
                  <div className={styles.stat}>
                    <Text weight="2" Component="div">
                      {profile.data.tripsCount}
                    </Text>
                    <Caption
                      Component="div"
                      className={styles.statLabel}
                    >
                      Поездок
                    </Caption>
                  </div>
                  <div className={styles.stat}>
                    <Text
                      weight="2"
                      Component="div"
                      className={styles.statInfo}
                    >
                      {profile.data.reviewsCount}
                    </Text>
                    <Caption
                      Component="div"
                      className={styles.statLabel}
                    >
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
                    <Caption
                      Component="div"
                      className={styles.statLabel}
                    >
                      Рейтинг
                    </Caption>
                  </div>
                </div>

                {subtab === "settings" && (
                  <Button
                    mode="bezeled"
                    stretched
                    size="s"
                    onClick={() => {
                      haptic.light();
                      navigate("/profile/edit");
                    }}
                  >
                    Редактировать профиль
                  </Button>
                )}
              </SectionBody>
            </Section>

            {/* Субтабы: Настройки и авто / Отзывы */}
            <div role="tablist" aria-label="Разделы профиля">
              <SegmentedControl>
                <SegmentedControl.Item
                  role="tab"
                  selected={subtab === "settings"}
                  aria-selected={subtab === "settings"}
                  onClick={() => pickSubtab("settings")}
                >
                  Настройки и авто
                </SegmentedControl.Item>
                <SegmentedControl.Item
                  role="tab"
                  selected={subtab === "reviews"}
                  aria-selected={subtab === "reviews"}
                  onClick={() => pickSubtab("reviews")}
                >
                  {`Отзывы (${profile.data.reviewsCount})`}
                </SegmentedControl.Item>
              </SegmentedControl>
            </div>

            {subtab === "settings" ? (
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
                  <div className={styles.stack}>
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
                    {themeOverride && (
                      <Button
                        mode="bezeled"
                        stretched
                        size="s"
                        onClick={() => {
                          haptic.light();
                          setThemeOverride(null);
                        }}
                      >
                        Как в Telegram
                      </Button>
                    )}
                  </div>
                </Section>

                <Section header="Уведомления и звуки">
                  <div className={styles.stack}>
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
                  </div>
                </Section>

                <Section header="Сервис и помощь">
                  <div className={styles.stack}>
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
                  </div>
                </Section>

                {/* Опасная зона — как Delete My Account официалки:
                    красная текст-строка влево (без фона кнопки) + хинт
                    последствий; подтверждение — нативный алерт.
                    Кнопки «Выйти» нет. */}
                <div className={styles.dangerZone}>
                  {remove.error && (
                    <Caption
                      Component="p"
                      role="alert"
                      className={styles.errorText}
                    >
                      {remove.error instanceof ApiError &&
                      remove.error.code === "ACCOUNT_HAS_ACTIVE_OBLIGATIONS"
                        ? "Завершите активные поездки и отмените брони, затем повторите удаление."
                        : remove.error instanceof Error
                          ? remove.error.message
                          : "Не удалось удалить профиль"}
                    </Caption>
                  )}
                  <div className={styles.dangerDelete}>
                    <ConfirmPopup
                      label="Удалить профиль"
                      confirmLabel="Удалить окончательно"
                      description="Аккаунт будет анонимизирован, поездки и отзывы сохранятся без вашего имени. Активные поездки и брони завершите или отмените заранее. Восстановление невозможно."
                      pending={remove.isPending}
                      disabled={remove.isPending}
                      mode="plain"
                      destructive
                      onConfirm={() => remove.mutate()}
                    />
                  </div>
                  <Caption Component="p" className={styles.dangerHint}>
                    Аккаунт будет анонимизирован. Поездки и отзывы сохранятся
                    без вашего имени. Восстановление невозможно.
                  </Caption>
                </div>
              </Stack>
            ) : (
              <div className={styles.reviews}>
                <div className={styles.reviewNotice}>
                  <span className={styles.hint}>
                    Все отзывы проходят пре-модерацию
                  </span>
                  <Button
                    size="s"
                    mode="bezeled"
                    onClick={() => navigate("/reviews")}
                  >
                    Оставить отзыв
                  </Button>
                </div>

                <QueryState
                  loading={aboutReviews.isLoading}
                  error={aboutReviews.error}
                  empty={aboutItems.length === 0}
                  emptyText="После поездок пассажиры и водители смогут оценить вас — отзывы появятся здесь."
                  onRetry={() => void aboutReviews.refetch()}
                >
                  <div className={styles.reviews}>
                    {aboutItems.map((review) => (
                      <ReviewCard key={review.id} review={review} />
                    ))}
                    {aboutReviews.hasNextPage && (
                      <Button
                        mode="bezeled"
                        stretched
                        loading={aboutReviews.isFetchingNextPage}
                        disabled={aboutReviews.isFetchingNextPage}
                        onClick={() => void aboutReviews.fetchNextPage()}
                      >
                        Показать ещё
                      </Button>
                    )}
                  </div>
                </QueryState>
              </div>
            )}
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
