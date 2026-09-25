/**
 * Единый словарь пустых состояний (U4).
 *
 * Канон: все экраны берут тексты пустых состояний отсюда — через
 * `QueryState` (поле `emptyText` = `EMPTY_STATES.<key>.description`,
 * заголовок «Пока пусто» уже внутри QueryState) или напрямую через
 * `ui/EmptyState` (`header`/`description` из записи). Новые пустые
 * состояния — новая запись здесь, а не литерал в экране.
 *
 * Тексты зафиксированы 1:1 (смена формулировок вне скоупа U4):
 * SSR-тесты ищут эти строки («Пока пусто», «Пока тихо»,
 * «Поездок не найдено», «Вы пока не отправляли жалоб», «Заявок нет»
 * и др.). Юнит-тест `ui/__tests__/emptyStates.test.ts` лочит словарь.
 *
 * Граница: сюда входят только пустые состояния (нет данных).
 * НЕ входят: ошибки/гейты авторизации и онбординга (AuthGate,
 * Onboarding, EnvUnsupported), тексты confirm-диалогов, динамические
 * описания ошибок (helper `bookingErrorMessage`), нативные пропсы кита
 * (`Multiselect emptyText` — текст дропдауна, не экрана), промо-CTA
 * (`HomePage` «Едете на машине?» — маркетинг, не пустое состояние).
 */
export const EMPTY_STATES = {
  /** Заголовок по умолчанию ветки empty в QueryState. */
  genericEmpty: {
    header: "Пока пусто",
  },
  /** Ветка error в QueryState (идёт через EmptyState). */
  loadError: {
    header: "Не удалось загрузить данные",
    description: "Проверьте соединение и повторите попытку.",
  },
  /** Активные поездки/брони (TripActivePage → QueryState emptyText). */
  tripActive: {
    header: "Пока пусто",
    description:
      "Пока тихо: забронируйте поездку или опубликуйте свой маршрут!",
  },
  /** История поездок (TripHistoryPage → QueryState emptyText). */
  tripHistory: {
    header: "Пока пусто",
    description: "Здесь появятся завершённые и отменённые поездки.",
  },
  /** Поиск без результатов (SearchPage). */
  searchNoResults: {
    header: "Поездок не найдено",
    description:
      "Попробуйте изменить города или выбрать другие даты отправления",
  },
  /** Детали: поездка не найдена (заголовок; описание — ниже/динамика). */
  tripNotFound: {
    header: "Поездка не найдена",
  },
  /** Детали: 404 — поездка удалена или ссылка устарела. */
  tripNotFoundDeleted: {
    header: "Поездка не найдена",
    description: "Возможно, поездка была удалена или ссылка устарела.",
  },
  /** Детали: фолбэк без объекта ошибки. */
  tripNotFoundHint: {
    header: "Поездка не найдена",
    description: "Вернитесь к поиску и выберите другую поездку.",
  },
  /** Детали: нет свободных мест. */
  tripNoSeats: {
    header: "Свободных мест нет",
    description: "Попробуйте другую поездку или оставьте запрос попутчика.",
  },
  /** Детали: поездка уже уехала. */
  tripDeparted: {
    header: "Поездка уже отправилась",
    description: "Бронирование недоступно. Найдите другую поездку.",
  },
  /** Детали: статусы. */
  tripCancelled: {
    header: "Поездка отменена",
  },
  /** Детали: статусы. */
  tripCompleted: {
    header: "Поездка завершена",
  },
  /** Заявки пассажиров пусты (TripRequestsModal). */
  tripRequestsEmpty: {
    header: "Заявок нет",
  },
  /** Запросы попутчика пусты (RideRequestsModal → QueryState emptyText). */
  rideRequestsEmpty: {
    header: "Пока пусто",
    description: "Активных запросов нет.",
  },
  /** Свои жалобы пусты (ReportsPage). */
  reportsEmpty: {
    header: "Вы пока не отправляли жалоб",
    description:
      "Жалобы на поездки доступны пассажирам с бронью. На свою поездку жаловаться нельзя.",
  },
  /** Отзывы: вкладка «Мои» пуста (ReviewsModal). */
  reviewsMineEmpty: {
    header: "Вы пока не оставили отзывов",
    description:
      "Оставьте отзыв о поездке — это поможет другим выбрать маршрут",
  },
  /** Отзывы: нет поездок для отзыва (ReviewsModal, ReviewsPage). */
  reviewsNewEmpty: {
    header: "Пока нет поездок для отзыва",
    description: "Когда вы совершите поездку, она появится здесь",
  },
  /** Отзывы: вкладка «Обо мне» пуста (ReviewsModal; без точки на конце). */
  reviewsAboutEmpty: {
    header: "О вас пока нет отзывов",
    description:
      "После поездок пассажиры и водители смогут оценить вас — отзывы появятся здесь",
  },
  /** Отзывы в профиле пусты (ProfilePage → QueryState emptyText; с точкой). */
  profileReviewsEmpty: {
    header: "Пока пусто",
    description:
      "После поездок пассажиры и водители смогут оценить вас — отзывы появятся здесь.",
  },
  /** Уведомления пусты (NotificationsPage). */
  notificationsEmpty: {
    header: "Пока нет уведомлений",
    description:
      "Подтверждения брони, отмены и завершение поездок появятся здесь",
  },
  /** Обращения в поддержку пусты (SupportPage). */
  supportEmpty: {
    header: "У вас пока нет обращений",
    description: "Здесь появятся ваши обращения и ответы поддержки",
  },
  /** Профиль не загрузился (ProfilePage → QueryState emptyText). */
  profileEmpty: {
    header: "Пока пусто",
    description: "Не удалось загрузить профиль.",
  },
  /** Настройки не загрузились (SettingsPage/SettingsModal → emptyText). */
  settingsEmpty: {
    header: "Пока пусто",
    description: "Не удалось загрузить настройки.",
  },
  /** Автомобиль не загрузился (VehicleModal → QueryState emptyText). */
  vehicleEmpty: {
    header: "Пока пусто",
    description: "Не удалось загрузить автомобиль.",
  },
} as const;

export type EmptyStateKey = keyof typeof EMPTY_STATES;
