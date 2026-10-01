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
  "trip_status_changed",
]);

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
 *   (получатель — автор запроса);
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
