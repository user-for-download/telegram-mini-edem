import { useMemo, type KeyboardEvent, useState, type ReactNode } from "react";
import {
  Avatar,
  Badge,
  Caption,
  Headline,
  IconContainer,
  SegmentedControl,
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
import { ReviewCard } from "@/components/ReviewCard/ReviewCard";
import { FeedbackModal } from "@/components/Profile/FeedbackModal";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Section } from "@/ui/Section";
import { Stack } from "@/ui/Stack";
import { FetchMore } from "@/ui/FetchMore";
import { Notice } from "@/ui/Notice";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { GROW, HINT, INFO, PROSE_TEXT, TRUNCATE } from "@/ui/classes";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { ACCOUNT_DELETED_MESSAGE, ApiError } from "@/api/client";
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

/** Обрезка в одну строку + блочный display (span/caption-типографика tgui).
 * ellipsis-рецепт — канонный TRUNCATE из @/ui/classes, block — локальный. */
const TRUNCATE_BLOCK = `${TRUNCATE} ${styles.truncateBlock}`;

type ProfileSubtab = "settings" | "reviews";

/**
 * Связка `tab` ↔ `tabpanel` для субтабов профиля (реестр B5).
 *
 * Замер 2026-10-02: на странице было 2 `role="tab"`, но ни одного
 * `role="tabpanel"`, и ни у одного таба не было `aria-controls` — то есть
 * роли объявляли переключение, а панели под ними не существовало для
 * скринридера. Расхождение с ARIA APG: таб без панели бессмысленен.
 *
 * Стабильные id обязательны: без них связь «я управляю вот этой панелью»
 * не выражается, а сгенерированные id менялись бы между рендерами.
 *
 * `aria-controls` вешаем ТОЛЬКО на выбранный таб: панели рендерятся условно,
 * и у невыбранного таба просто нет панели — ссылаться на несуществующий id
 * было бы враньём (проверено: `document.getElementById` давал null на
 * невыбранном табе). Отрисовывать обе панели с `hidden` ради полноты APG
 * не стали: это заставило бы грузить отзывы при открытых настройках.
 */
const SUBTAB_IDS: Record<ProfileSubtab, string> = {
  settings: "profile-subtab-settings",
  reviews: "profile-subtab-reviews",
};

const SUBTAB_PANEL_IDS: Record<ProfileSubtab, string> = {
  settings: "profile-subtab-panel-settings",
  reviews: "profile-subtab-panel-reviews",
};

/**
 * Каскад удаления аккаунта — юридический текст в одном месте.
 *
 * Раньше абзац повторялся почти дословно в футере «Опасной зоны» и в
 * description ConfirmPopup: правка формулировки разъезжалась, и два
 * экрана могли обещать разное. Здесь только хвост — префикс
 * «Аккаунт будет анонимизирован.» нужен лишь в диалоге.
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
      // Имя = заголовок + подпись. Раньше было aria-label={label} (только
      // заголовок), и видимая подпись в имя не входила: «История поездок»,
      // «Автомобиль», «Служба поддержки», «Жалобы» звучали для скринридера
      // голым заголовком без описания (замер 2026-10-02 на /profile).
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
          // Настройка вкл/выкл — это.switch по APG, а не чекбокс: скринридер
          // обязан озвучивать «включено/выключено», а не «отмечено/не отмечено».
          // ARIA-checked не задаём руками: для input[type=checkbox] браузер
          // выводит его из checked сам, а дублирование рискует разойтись с
          // реальным состоянием (замер 2026-10-03 до правки: роль отсутствовала,
          // реестр B6).
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
 * с рейтингом и статистикой, субтабы «Настройки и авто» / «Отзывы».
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
    if (profile.error.message === ACCOUNT_DELETED_MESSAGE) {
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

  const pickSubtab = (next: ProfileSubtab) => {
    if (next === subtab) return;
    haptic.selection();
    setSubtab(next);
  };

  /**
   * Стрелки/Home/End по табам (ARIA APG, автоматическая активация).
   *
   * Замер 2026-10-03: keydown до кнопки доходил (`ArrowRight@BUTTON` в логе),
   * но NOTHING его не обрабатывал — ArrowRight/ArrowDown/Home/End не меняли
   * выбранный таб. Табы при этом фокусируются Tab'ом и активируются
   * Enter/Space (нативная кнопка), то есть страница не была непроходимой
   * для клавиатуры — но паттерн APG требует стрелки, и без них переключение
   * «на глазок» вслепую: скринридер объявляет «выбран вкладка 1 из 2», а
   * перейти к содержимому второй можно только Tab'ом через всю страницу.
   */
  const onSubtabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const order: ProfileSubtab[] = ["settings", "reviews"];
    const current = order.indexOf(subtab);
    let next: ProfileSubtab | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = order[(current + 1) % order.length];
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = order[(current - 1 + order.length) % order.length];
    } else if (event.key === "Home") {
      next = order[0];
    } else if (event.key === "End") {
      next = order[order.length - 1];
    } else {
      return;
    }
    if (!next) return;
    event.preventDefault();
    pickSubtab(next);
    // Фокус переезжает на новый таб: без этого стрелка меняла выделение, но
    // фокус оставался на старом, и следующий Tab уходил из списка.
    document.getElementById(SUBTAB_IDS[next])?.focus();
  };

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
                секций — h2. До правки было шесть h1 («Мои поездки»,
                «Мой автомобиль», «Внешний вид», «Уведомления и звуки»,
                «Сервис и помощь», «Опасная зона») и ни одного h1 у страницы.
                Заголовок секции не может быть h1 по умолчанию — это
                теперь гарантирует фасад (telegram-app/src/ui/Section.tsx). */}
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

                {subtab === "settings" && (
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
                )}
              </SectionBody>
            </Section>

            {/* Субтабы: Настройки и авто / Отзывы */}
            <div
              role="tablist"
              aria-label="Разделы профиля"
              tabIndex={-1}
              onKeyDown={onSubtabKeyDown}
            >
              <SegmentedControl>
                <SegmentedControl.Item
                  role="tab"
                  id={SUBTAB_IDS.settings}
                  aria-controls={
                    subtab === "settings" ? SUBTAB_PANEL_IDS.settings : undefined
                  }
                  selected={subtab === "settings"}
                  aria-selected={subtab === "settings"}
                  onClick={() => pickSubtab("settings")}
                >
                  Настройки и авто
                </SegmentedControl.Item>
                <SegmentedControl.Item
                  role="tab"
                  id={SUBTAB_IDS.reviews}
                  aria-controls={
                    subtab === "reviews" ? SUBTAB_PANEL_IDS.reviews : undefined
                  }
                  selected={subtab === "reviews"}
                  aria-selected={subtab === "reviews"}
                  onClick={() => pickSubtab("reviews")}
                >
                  {`Отзывы (${profile.data.reviewsCount})`}
                </SegmentedControl.Item>
              </SegmentedControl>
            </div>

            {subtab === "settings" ? (
              <Stack
                role="tabpanel"
                id={SUBTAB_PANEL_IDS.settings}
                aria-labelledby={SUBTAB_IDS.settings}
              >
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
                  {/* Ошибка сохранения настроек раньше не показывалась
                      вообще: toggleNotifications делал haptic.error() и откатывал
                      флаг, так что переключатель молча «отскакивал», а
                      пользователь не знал почему (замер 2026-10-02: PATCH 500 →
                      role=alert пуст, текста ошибки на экране нет). Ошибка удаления
                      профиля в «Опасной зоне» рендерилась, эта — нет. */}
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
            ) : (
              <Stack
                role="tabpanel"
                id={SUBTAB_PANEL_IDS.reviews}
                aria-labelledby={SUBTAB_IDS.reviews}
              >
                <Notice variant="banner" tone="info">
                  <span className={HINT}>
                    Все отзывы проходят пре-модерацию
                  </span>
                  <Button size="s" onClick={() => navigate("/reviews")}>
                    Оставить отзыв
                  </Button>
                </Notice>

                <QueryState
                  loading={aboutReviews.isLoading}
                  error={aboutReviews.error}
                  empty={aboutItems.length === 0}
                  emptyText={EMPTY_STATES.profileReviewsEmpty.description}
                  onRetry={() => void aboutReviews.refetch()}
                >
                  <Stack>
                    {aboutItems.map((review) => (
                      <ReviewCard key={review.id} review={review} />
                    ))}
                    <FetchMore
                      hasNextPage={aboutReviews.hasNextPage}
                      isFetchingNextPage={aboutReviews.isFetchingNextPage}
                      fetchNextPage={() => void aboutReviews.fetchNextPage()}
                    />
                  </Stack>
                </QueryState>
              </Stack>
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
