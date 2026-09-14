import { useMemo, useState, type ReactNode } from "react";
import {
  Avatar,
  Button,
  Headline,
  List,
  Placeholder,
  Section,
  SegmentedControl,
  Switch,
} from "@telegram-apps/telegram-ui";
import {
  Bell,
  Car,
  ChevronRight,
  Flag,
  LogOut,
  Moon,
  Star,
  Trash2,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { miniApp, useSignal } from "@telegram-apps/sdk-react";
import { useNavigate } from "react-router-dom";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { ReviewCard } from "@/components/ReviewCard";
import { FeedbackModal } from "@/components/FeedbackModal";
import { ApiError } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import {
  useDeleteAccountMutation,
  useLogoutMutation,
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

type ProfileSubtab = "settings" | "reviews";

/**
 * Строка меню раздела — нативная кнопка во всю ширину (язык компактных
 * карточек приложения). tgui Cell с Component="button" наследует базовые
 * стили Button (inline-flex + nowrap) и вылезает за экран на 150px+.
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
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="w-full min-w-0 flex items-center gap-3 p-3 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] text-left hover:border-[var(--app-info)] transition"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium text-[var(--tgui--text_color)] truncate">
          {title}
        </span>
        <span className="block text-[12px] text-[var(--tgui--hint_color)] truncate">
          {subtitle}
        </span>
      </span>
      <ChevronRight size={16} className="text-[var(--tgui--hint_color)] shrink-0" />
    </button>
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
    <div className="w-full flex items-center gap-3 p-3 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)]">
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-medium text-[var(--tgui--text_color)] truncate">
          {title}
        </span>
        <span className="block text-[12px] text-[var(--tgui--hint_color)] truncate">
          {subtitle}
        </span>
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
 * выход (POST /auth/logout + локальная очистка) и удаление аккаунта
 * (двойное подтверждение, обработка активных обязательств 409).
 * Бан/удаление mid-session: requireUser отвечает 403 — показываем
 * терминальные экраны вместо общей ошибки.
 */
export function ProfilePage() {
  const navigate = useNavigate();
  const me = useAuthStore((state) => state.user);
  const profile = useProfileQuery();
  const logout = useLogoutMutation();
  const remove = useDeleteAccountMutation();
  const saveNotifications = useProfileNotificationSettingsMutation();
  const { themeOverride, soundEnabled } = useAppSettings();
  const tgDark = useSignal(miniApp.isDark);
  const dark = themeOverride ? themeOverride === "dark" : tgDark;
  const [notifEnabled, setNotifEnabled] = useState<boolean | null>(null);
  const notifChecked = notifEnabled ?? profile.data?.notificationsEnabled ?? true;

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

  const handleLogout = () => {
    if (window.confirm("Выйти из аккаунта на этом устройстве?")) {
      logout.mutate();
    }
  };

  const handleDeleteAccount = () => {
    const first = window.confirm(
      "Удалить профиль? Аккаунт будет анонимизирован, поездки и отзывы сохранятся без вашего имени. Активные поездки и брони нужно завершить или отменить заранее. Продолжить?",
    );
    if (!first) return;
    const second = window.confirm(
      "Подтвердите удаление: восстановление будет невозможно. Удалить профиль окончательно?",
    );
    if (!second) return;
    remove.mutate();
  };

  if (profile.error instanceof ApiError && profile.error.status === 403) {
    if (profile.error.message === "Account is deleted") {
      return (
        <Placeholder
          header="Профиль удалён"
          description="Аккаунт анонимизирован. Поездки и отзывы сохранены без вашего имени. Восстановление невозможно."
        />
      );
    }
    return (
      <Placeholder
        header="Аккаунт заблокирован"
        description="Действие недоступно: аккаунт заблокирован. Обжалование пока недоступно в Telegram."
      />
    );
  }

  const pickSubtab = (next: ProfileSubtab) => {
    if (next === subtab) return;
    haptic.selection();
    setSubtab(next);
  };

  return (
    <>
      <MutationError error={logout.error} />
      <QueryState
        loading={profile.isLoading}
        error={profile.error}
        empty={!profile.data}
        emptyText="Не удалось загрузить профиль."
        onRetry={() => void profile.refetch()}
      >
        {profile.data && (
          <div className="flex flex-col gap-4 px-4 pt-1 pb-4">
            {/* Шапка профиля */}
            <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] shadow-xs flex flex-col gap-3">
              <div className="flex items-center gap-3.5">
                <Avatar
                  size={48}
                  src={profile.data.avatar}
                  acronym={(profile.data.name ?? "П").slice(0, 2).toUpperCase()}
                />
                <div className="flex-1 min-w-0">
                  <Headline weight="2" className="!text-[18px] truncate">
                    {profile.data.name}
                  </Headline>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-[var(--tgui--secondary_fill)] text-[var(--tgui--link_color)]">
                      <Star size={11} className="fill-[var(--app-rating)] text-[var(--app-rating)]" />
                      {`${profile.data.rating.toFixed(1)} (${profile.data.reviewsCount})`}
                    </span>
                    <span className="text-[11px] text-[var(--app-success)] font-medium">
                      Telegram верифицирован
                    </span>
                  </div>
                </div>
              </div>

              {profile.data.about && (
                <p className="text-[13px] text-[var(--tgui--text_color)] leading-relaxed">
                  {profile.data.about}
                </p>
              )}

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--tgui--outline)]">
                <div className="p-2 rounded-xl bg-[var(--tgui--tertiary_bg_color)] text-center">
                  <div className="text-[16px] font-bold text-[var(--tgui--text_color)]">
                    {profile.data.tripsCount}
                  </div>
                  <div className="text-[11px] text-[var(--tgui--hint_color)]">Поездок</div>
                </div>
                <div className="p-2 rounded-xl bg-[var(--tgui--tertiary_bg_color)] text-center">
                  <div className="text-[16px] font-bold text-[var(--app-info)]">
                    {profile.data.reviewsCount}
                  </div>
                  <div className="text-[11px] text-[var(--tgui--hint_color)]">Отзывов</div>
                </div>
                <div className="p-2 rounded-xl bg-[var(--tgui--tertiary_bg_color)] text-center">
                  <div className="text-[16px] font-bold text-[var(--app-rating)]">
                    {profile.data.rating.toFixed(1)}
                  </div>
                  <div className="text-[11px] text-[var(--tgui--hint_color)]">Рейтинг</div>
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
            </div>

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
              <List className="!p-0 flex flex-col gap-3">
                <Section header="Мой автомобиль (для поездок)">
                  <MenuRow
                    label={profile.data.car ? "Автомобиль" : "Добавить автомобиль"}
                    icon={
                      <span className="icon-circle icon-circle--info">
                        <Car size={20} />
                      </span>
                    }
                    title={profile.data.car ? "Автомобиль" : "Добавить автомобиль"}
                    subtitle={
                      profile.data.car
                        ? `${profile.data.car.model} · ${profile.data.car.color}`
                        : "Добавьте автомобиль, чтобы создавать поездки"
                    }
                    onClick={() => navigate("/vehicle")}
                  />
                </Section>

                <Section header="Внешний вид">
                  <div className="flex flex-col gap-2">
                    <SwitchRow
                      label="Тёмная тема"
                      icon={
                        <span className="icon-circle icon-circle--purple">
                          <Moon size={18} />
                        </span>
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
                  <div className="flex flex-col gap-2">
                    <SwitchRow
                      label="Уведомления"
                      icon={
                        <span className="icon-circle icon-circle--info">
                          <Bell size={18} />
                        </span>
                      }
                      title="Уведомления"
                      subtitle="Брони, статусы поездок, ответы поддержки"
                      checked={notifChecked}
                      onChange={toggleNotifications}
                    />
                    <SwitchRow
                      label="Звуковые эффекты"
                      icon={
                        <span className="icon-circle icon-circle--warning">
                          <Volume2 size={18} />
                        </span>
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
                  <div className="flex flex-col gap-2">
                    <MenuRow
                      label="Служба поддержки"
                      icon={
                        <span className="icon-circle icon-circle--purple">
                          <TriangleAlert size={18} />
                        </span>
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
                        <span className="icon-circle icon-circle--danger">
                          <Flag size={18} />
                        </span>
                      }
                      title="Жалобы"
                      subtitle="Сообщить о проблеме с пользователем"
                      onClick={() => navigate("/profile/reports")}
                    />
                  </div>
                </Section>

                {/* Опасная зона */}
                <div className="p-4 rounded-2xl bg-[var(--tgui--section_bg_color)] border border-[var(--app-danger)]/30 shadow-xs flex flex-col gap-2">
                  <Button
                    mode="bezeled"
                    stretched
                    size="s"
                    before={<LogOut size={16} />}
                    loading={logout.isPending}
                    disabled={logout.isPending}
                    onClick={handleLogout}
                  >
                    Выйти
                  </Button>
                  {remove.error && (
                    <p className="FormError" role="alert">
                      {remove.error instanceof ApiError &&
                      remove.error.code === "ACCOUNT_HAS_ACTIVE_OBLIGATIONS"
                        ? "Завершите активные поездки и отмените брони, затем повторите удаление."
                        : remove.error instanceof Error
                          ? remove.error.message
                          : "Не удалось удалить профиль"}
                    </p>
                  )}
                  <Button
                    mode="gray"
                    stretched
                    size="s"
                    before={<Trash2 size={16} />}
                    loading={remove.isPending}
                    disabled={remove.isPending}
                    onClick={handleDeleteAccount}
                  >
                    Удалить профиль
                  </Button>
                </div>
              </List>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="p-3 rounded-xl bg-[var(--tgui--section_bg_color)] border border-[var(--tgui--outline)] flex items-center justify-between gap-2 text-xs">
                  <span className="text-[var(--tgui--hint_color)]">
                    Все отзывы проходят пре-модерацию
                  </span>
                  <Button size="s" mode="bezeled" onClick={() => navigate("/reviews")}>
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
                  <div className="flex flex-col gap-3">
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
          </div>
        )}
      </QueryState>
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </>
  );
}
