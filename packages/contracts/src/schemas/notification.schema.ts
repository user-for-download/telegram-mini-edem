import { z } from "zod";

/** User notification returned by GET /notifications/my and PATCH /:id/read. */
export const notificationSchema = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  isRead: z.boolean(),
  // Allowlist-маршрут telegram-app для тапа (напр. `/trips/<uuid>` —
  // шторка деталей поездки). null — у типа нет per-entity ссылки, клиент
  // использует fallback-карту по type. Значение уже провалидировано
  // сервером (resolveTelegramDeepLink), сырых данных/PII тут нет.
  deepLink: z.string().nullable(),
  // Кто — отображаемое имя второй стороны (вторая строка ячейки).
  // null — у события нет персоны.
  actorName: z.string().nullable(),
  // Машинный код действия (третья строка ячейки, client map).
  // null — легаси-записи без кода.
  action: z.string().nullable(),
  // Снапшот поездки для третьей строки («дата, время • цена • маршрут»).
  // null — у события нет поездки (отзывы, поддержка, легаси).
  tripFrom: z.string().nullable(),
  tripTo: z.string().nullable(),
  tripPrice: z.number().int().nullable(),
  tripDepartureAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export type Notification = z.infer<typeof notificationSchema>;

/** Cursor page returned by GET /notifications/my. */
export const notificationsPageSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().min(0).optional(),
});

export type NotificationsPage = z.infer<typeof notificationsPageSchema>;

/** Response returned by GET /notifications/unread-count. */
export const unreadCountSchema = z
  .object({
    unreadCount: z.number().int().min(0),
  })
  .strict();

export type UnreadCount = z.infer<typeof unreadCountSchema>;

/**
 * Критичные типы: персистятся в inbox независимо от тумблера
 * notificationsEnabled. ЕДИНЫЙ ИСТОЧНИК для backend (notification.service,
 * dispatcher) и клиента — дублирующих сетов быть не должно.
 */
export const CRITICAL_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "booking_status_changed",
  "trip_cancelled",
  "trip_details_changed",
  "trip_status_changed",
]);

/**
 * Тип уведомления-приглашения водителя: пассажир оставил заявку, водитель
 * позвал его именно в эту поездку. Бронь создаёт пассажир сам — в уведомлении
 * нет ничего, кроме deep-link на поездку и контекста маршрута.
 *
 * В `CRITICAL_NOTIFICATION_TYPES` его НЕТ намеренно: обычный тип уходит в
 * Telegram, когда тумблер юзера включён и он в чате (`shouldDeliverTelegram`),
 * поэтому отдельного кода «написать в Telegram» для приглашения не требуется.
 */
export const DRIVER_INVITE_NOTIFICATION_TYPE = "driver_invite";

/**
 * Deep-link на карточку поездки: `/trips/<uuid>` и ничего кроме.
 *
 * Форма не выдумана здесь, а зафиксирована allowlist-резолвером бэкенда
 * (`resolveTelegramDeepLink` / `TELEGRAM_EXACT_ROUTES`): параметризованные
 * маршруты — строго UUID, query/hash и сырые пользовательские данные в
 * deep-link запрещены. UUID здесь такой же «свободный», как в резолвере
 * бэкенда: жёсткий RFC-вариант (`z.string().uuid()`) отверг бы маршрут,
 * который сервер уже провалидировал и отдал клиенту.
 */
const TRIP_DEEP_LINK_RE =
  /^\/trips\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/**
 * Строка инбокса типа `driver_invite` — обычная `notificationSchema`, у
 * которой контекст поездки обязателен: у остальных типов он nullable (событие
 * могло обойтись без поездки), а приглашению поездка нужна, иначе тап по
 * уведомлению некуда вести и вторая строка ячейки останется пустой.
 *
 * Персональных данных тут нет: города и время — снимок поездки, второй
 * стороной события подписан водитель в `actorName` (как у
 * `ride_request_match`), id поездки несёт deep-link — отдельной колонки
 * `tripId` у `Notification` нет и заводить её ради этого не стали.
 */
export const driverInviteNotificationSchema = notificationSchema.extend({
  type: z.literal(DRIVER_INVITE_NOTIFICATION_TYPE),
  deepLink: z
    .string()
    .regex(TRIP_DEEP_LINK_RE, "deep-link приглашения — только /trips/<uuid>"),
  tripFrom: z.string().min(1),
  tripTo: z.string().min(1),
  tripDepartureAt: z.string().datetime(),
});

export type DriverInviteNotification = z.infer<
  typeof driverInviteNotificationSchema
>;

/**
 * Id поездки из deep-link приглашения — единственное место, где маршрут
 * разбирается на части. null — не приглашение (чужой или битый маршрут).
 */
export function tripIdFromDeepLink(deepLink: string): string | null {
  return TRIP_DEEP_LINK_RE.exec(deepLink)?.[1] ?? null;
}

/** Роль получателя для серверного фильтра `?role=` и ролевых архивов. */
export const notificationRoleSchema = z.enum(["driver", "passenger"]);

export type NotificationRole = z.infer<typeof notificationRoleSchema>;

/**
 * Карта type → роль получателя (сверена с backend по createNotification).
 * ЕДИНЫЙ ИСТОЧНИК — сервер фильтрует `GET /my?role=`, клиент передаёт сегмент
 * как есть и больше не фильтрует по типам сам.
 *
 * - driver: booking_created (получатель driverId), trip_status_changed
 *   (завершение своей поездки водителю — tripWorker);
 * - passenger: booking_status_changed, trip_cancelled, trip_status_changed,
 *   trip_details_changed (получатели — пассажиры), ride_request_match
 *   (получатель — автор запроса), driver_invite (получатель — приглашённый
 *   автор заявки);
 * - нейтральные (review_approved/rejected, feedback_replied, unknown) —
 *   ни в одной карте: видны только в очереди «Новые», архивного дома нет
 *   (осознанно: у них нет ролевого контекста поездки).
 */
export const NOTIFICATION_ROLE_TYPES: Readonly<
  Record<NotificationRole, ReadonlySet<string>>
> = {
  driver: new Set(["booking_created", "trip_status_changed"]),
  passenger: new Set([
    "booking_status_changed",
    "trip_cancelled",
    "trip_status_changed",
    "trip_details_changed",
    "ride_request_match",
    DRIVER_INVITE_NOTIFICATION_TYPE,
  ]),
};

/**
 * Query `GET /notifications/my`: серверный фильтр архивов.
 * role — ролевой архив (без него — все типы, очередь «Новые» тоже фильтруется
 * только по unreadOnly); unreadOnly=1 — только непрочитанные.
 */
export const notificationsQuerySchema = z.object({
  role: notificationRoleSchema.optional(),
  unreadOnly: z.literal("1").optional(),
});

export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>;
