import { IconContainer, VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Blockquote } from "@/ui/Blockquote";
import { ProfileHero } from "@/components/Profile/ProfileHero";
import { MenuRow } from "@/ui/MenuRow";
import { SwitchRow } from "@/ui/SwitchRow";

import {
  Bell,
  Car,
  ClipboardList,
  Flag,
  History,
  Moon,
  Star,
  TriangleAlert,
  Volume2,
  Edit3,
} from "lucide-react";
import { miniApp, useSignal } from "@tma.js/sdk-react";
import { useNavigate } from "react-router-dom";
import { ConfirmPopup } from "@/components/ConfirmPopup";
import { QueryState } from "@/components/QueryState";
import { MutationError } from "@/components/MutationError";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Section } from "@/ui/Section";
import { Stack } from "@/ui/Stack";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { MIN_TARGET } from "@/ui/classes";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { isAccountDeletedError, ApiError } from "@/api/client";
import {
  useDeleteAccountMutation,
  useProfileQuery,
} from "@/queries/profile";
import {
  setSoundEnabled,
  setThemeOverride,
  useAppSettings,
} from "@/utils/appSettings";
import { haptic } from "@/utils/haptics";
import styles from "./ProfilePage.module.css";

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
  const { themeOverride, soundEnabled } = useAppSettings();
  const tgDark = useSignal(miniApp.isDark);
  const dark = themeOverride ? themeOverride === "dark" : tgDark;
  // Уведомления — не состояние этой страницы: настройка живёт в шторке
  // «Настройки» (/settings), сюда едет только строка-переход.
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
            {/* Шапка профиля: центрированная витрина. Поверхность —
                Section без заголовка, сама шапка — общий ProfileHero
                (свой CSS-модуль) со слотом кнопки правки. */}
            <Section>
              <SectionBody>
                {/* Шапка — общий ProfileHero: тот же блок показывается в
                    шторке профиля другого человека, там разница только в
                    пропах (нет телефона и кнопки правки). */}
                <ProfileHero
                  user={profile.data}
                  phone={profile.data.phone}
                  action={
                    // Не stretched: кнопка правки не основное действие
                    // экрана, по центру она читается как вторичная.
                    <Button
                      size="s"
                      variant="gray"
                      className={styles.heroEdit}
                      before={<Edit3 size={15} />}
                      onClick={() => {
                        haptic.light();
                        navigate("/profile/edit");
                      }}
                    >
                      Редактировать профиль
                    </Button>
                  }
                />

                {/* «О себе» — свободный текст человека, поэтому ровно та же
                    плашка-цитата, что в шторке профиля (UserProfileSheet):
                    одно поле на двух экранах не должно выглядеть по-разному, а
                    правило переносов (`pre-wrap` + `overflow-wrap`) общее для
                    всех мест, где текст писал человек. */}
                {profile.data.about && (
                  <Blockquote>{profile.data.about}</Blockquote>
                )}
                {/* Плитки «Поездки / Отзывы / Рейтинг» убраны: те же три
                    числа уже стоят строкой метрик в шапке, а дубль на одном
                    экране читался как «четыре показателя» вместо трёх. */}
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
                  subtitle="Завершённые и отменённые"
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
                  subtitle={`Мои отзывы и обо мне · ${profile.data.reviewsCount}`}
                  onClick={() => {
                    haptic.light();
                    navigate("/reviews");
                  }}
                />
              </Section>
              <Section header="Мой автомобиль">
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
                      : "Нужен для создания поездок"
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
                {/* Уведомления — строка-ПЕРЕХОД, а не тумблер: сама
                    настройка живёт в шторке «Настройки» (`/settings` — тот же
                    маршрут, что у диплинка START_PARAM_ROUTES, и та же
                    шторка, что у «Автомобиля» рядом). До 2026-10-19 контролов
                    было ДВА — тумблер здесь и кнопка-команда в шторке: одна
                    серверная настройка в двух разных обличьях и с двумя
                    поверхностями ошибки, и оба писали PATCH наперегонки.
                    Правило реестра #30 («настройка вкл/выкл — это switch»)
                    оставлено за шторкой, где контрол один. */}
                <MenuRow
                  label="Настройки уведомлений"
                  icon={
                    <IconContainer>
                      <Bell size={18} />
                    </IconContainer>
                  }
                  title="Настройки уведомлений"
                  subtitle="Брони и статусы поездок"
                  onClick={() => {
                    haptic.light();
                    navigate("/settings");
                  }}
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
                  subtitle="Вопросы и обращения"
                  onClick={() => {
                    // Страница /profile/support — единственный экран
                    // поддержки: FAQ, форма обращения и мои обращения.
                    // Раньше здесь открывалась шторка с дублем той же
                    // формы, которая сама вела на эту страницу.
                    haptic.light();
                    navigate("/profile/support");
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
                  subtitle="На пользователя или бронь"
                  onClick={() => navigate("/profile/reports")}
                />
              </Section>
              {/* Опасная зона — как Add Account официалки: секция,
                    в ней красная надпись-кнопка, описание — в футере
                    секции. Кнопки «Выйти» нет. */}
              <Section header="Опасная зона" footer={DELETE_ACCOUNT_WARNING}>
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
                  className={MIN_TARGET}
                  onConfirm={() => remove.mutate()}
                />
              </Section>
            </Stack>
          </Page>
        )}
      </QueryState>
    </>
  );
}
