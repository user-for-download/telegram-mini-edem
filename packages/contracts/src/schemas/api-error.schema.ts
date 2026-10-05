import { z } from "zod";

/**
 * Протокол ошибок API — часть контракта, потому что по нему клиент
 * ПРИНИМАЕТ решение, а не просто отображает текст.
 *
 * Главный случай: 403 бывает двух видов — аккаунт удалён и аккаунт забанен.
 * Разные терминальные экраны и разные последствия (удалённый восстановиться
 * не может, банному положена апелляция). Раньше оба делили код `FORBIDDEN`,
 * и клиент отличал их ТОЛЬКО по тексту сообщения: переформулируй бэк — и
 * удалённый аккаунт молча уезжал на экран бана. Теперь у удаления отдельный
 * машинный код, и решение принимается по коду.
 *
 * Константы живут здесь, а не в клиенте или в errors.ts бэка: раньше строка
 * копировалась в четыре места и разъезжалась.
 */

/**
 * Код 403 удалённого аккаунта (`deletedAt`).
 * Соответствует `backend/src/errors.ts::ERROR_CODES.ACCOUNT_DELETED`.
 */
export const ACCOUNT_DELETED_CODE = "ACCOUNT_DELETED";

/**
 * Текст 403 удалённого аккаунта.
 *
 * Оставлен как ФОЛБЭК для бэка, который ещё не отдаёт `ACCOUNT_DELETED`:
 * новый клиент должен понимать и тот, и тот ответ. Поэтому текст НЕ меняем —
 * от него зависят старые клиенты в проде.
 */
export const ACCOUNT_DELETED_MESSAGE = "Account is deleted";

/**
 * Причины терминального закрытия WebSocket (код 4403).
 *
 * Тоже протокол, но НЕ код ошибки: у WS close-кадра нет структурированного
 * поля, поэтому сервер пишет строкой — и у удаления их ДВЕ (ws-auth и
 * самоудаление, различаются на «is»). Клиент обязан знать обе.
 */
export const WS_TERMINAL_REASON = {
  /** ws-auth, deletedAt — backend/src/ws/index.ts */
  deletedByWsAuth: ACCOUNT_DELETED_MESSAGE,
  /** DELETE /me, самоудаление — backend/src/users/index.ts, без «is» */
  deletedBySelf: "Account deleted",
  /** бан — backend/src/ws/index.ts и backend/src/admin/index.ts */
  banned: "Account is banned",
} as const;

type MaybeApiErrorRecord = { code?: unknown; message?: unknown };

/**
 * Единственное место, где по записи ошибки решают, что аккаунт удалён.
 *
 * Принимает и `ApiError` клиента, и сырое тело JSON-ответа: в ветке refresh
 * до готового `ApiError` дело не доходит. Статус 403 и тип ошибки проверяют
 * вызывающие — предикат отвечает только за различение удаления и бана.
 *
 * Фолбэк по тексту требует, чтобы запись ВЫГЛЯДЕЛА как конверт ошибки API
 * (есть строковый `code`). Без этого «Account is deleted» в сообщении любой
 * ошибки — включая голый `new Error(...)`, у которого `code` нет вовсе —
 * выдавала бы себя за протокольный ответ бэка.
 */
export function isAccountDeletedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const record = error as MaybeApiErrorRecord;
  if (record.code === ACCOUNT_DELETED_CODE) return true;
  return (
    typeof record.code === "string" && record.message === ACCOUNT_DELETED_MESSAGE
  );
}

/**
 * Конверт ошибки API — спецификация формы. `code` — машинный идентификатор,
 * по нему клиент принимает решения; `message` — человекочитаемый текст и НЕ
 * является частью контракта (клиент показывает свои формулировки по коду).
 *
 * ВАЖНО: это описание формата, а не то, чем сейчас разбирает ответы клиент.
 * `telegram-app/src/api/client.ts::toErrorRecord` разбирает тело РУКАМИ через
 * `Reflect.get` — и это сделано намеренно: разбор должен пережить не-JSON
 * ответ (пустое тело, HTML от nginx, заглушка прокси) и НЕ потерять HTTP-статус.
 * Наивная замена на `apiErrorSchema.parse` начала бы ронять разбор на мусорных
 * телах, то есть ухудшила бы сообщения об ошибках именно там, где сейчас всё
 * работает. Не подменять без отдельного замера поведения на кривых телах.
 *
 * Потребителя у схемы нет: webapp — только админка (`/api/v1/admin/*`, сессия
 * по ADMIN_TOKEN), а состояния удалённого пользователя там не существует.
 */
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  errors: z.unknown().optional(),
  // P2034 serialization-конфликты (409) клиент может безопасно повторить.
  retryable: z.boolean().optional(),
});

export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
