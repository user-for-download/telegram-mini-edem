import { apiGet, apiPatch } from "@/lib/api-client";
import {
  adminPaginatedUsersSchema,
  adminTelegramStopResponseDtoSchema,
  adminUserDetailDtoSchema,
  adminUserDtoSchema,
  type AdminTelegramStopResponseDto,
  type AdminUserDetailDto,
  type AdminUsersQuery,
} from "@edem/contracts";
import type { AdminPaginatedUsers, AdminUserDto, BanUserBody } from "@edem/contracts";

/**
 * Query-строка списка пользователей. Активные фильтры попадают в запрос,
 * пустые/пробельные — опускаются: бэкенд трактует отсутствие параметра как
 * «фильтр не задан» (см. adminUsersQuerySchema).
 *
 * Вынесено в чистую функцию, чтобы поведение фильтров покрывалось
 * node-тестами без DOM (webapp/vitest.config.ts).
 */
export function buildUsersSearchParams(params: AdminUsersQuery): URLSearchParams {
  const search = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });

  const setIfPresent = (key: string, value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) {
      search.set(key, trimmed);
    }
  };

  setIfPresent("q", params.q);
  setIfPresent("id", params.id);
  setIfPresent("telegramUserId", params.telegramUserId);
  setIfPresent("phone", params.phone);

  return search;
}

/**
 * GET /api/v1/admin/users?q=&id=&telegramUserId=&phone=&page=&pageSize=
 * Подстрочный поиск по имени и точные фильтры по id / Telegram id / телефону.
 */
export function fetchUsers(params: AdminUsersQuery): Promise<AdminPaginatedUsers> {
  return apiGet(
    "/users?" + buildUsersSearchParams(params).toString(),
    adminPaginatedUsersSchema,
  );
}

/**
 * GET /api/v1/admin/users/:id — карточка пользователя с ограниченными
 * списками последних поездок, броней, жалоб и обращений. PII отдаётся
 * только за adminGuard, поэтому не логируем ни запрос, ни ответ.
 */
export function fetchUserDetail(id: string): Promise<AdminUserDetailDto> {
  return apiGet(`/users/${encodeURIComponent(id)}`, adminUserDetailDtoSchema);
}

/**
 * PATCH /api/v1/admin/users/:id/telegram-stop — ручной стоп Telegram:
 * снимает согласие и гасит живые доставки. Идемпотентно.
 */
export function stopUserTelegram(id: string): Promise<AdminTelegramStopResponseDto> {
  return apiPatch(
    `/users/${encodeURIComponent(id)}/telegram-stop`,
    undefined,
    adminTelegramStopResponseDtoSchema,
  );
}

/**
 * PATCH /api/v1/admin/users/:id/ban — идемпотентный бан: сохраняет bannedAt и
 * обязательную причину (1–500 символов после trim). Контракт валидируется
 * сервером через banUserBodySchema.
 */
export function banUser(id: string, body: BanUserBody): Promise<AdminUserDto> {
  return apiPatch(`/users/${encodeURIComponent(id)}/ban`, body, adminUserDtoSchema);
}

/** PATCH /api/v1/admin/users/:id/unban — очищает bannedAt и banReason. */
export function unbanUser(id: string): Promise<AdminUserDto> {
  return apiPatch(`/users/${encodeURIComponent(id)}/unban`, undefined, adminUserDtoSchema);
}

/** PATCH /api/v1/admin/users/:id/onboarding-reset — обнуляет onboardingVersion. */
export function resetOnboarding(id: string): Promise<AdminUserDto> {
  return apiPatch(`/users/${encodeURIComponent(id)}/onboarding-reset`, undefined, adminUserDtoSchema);
}
