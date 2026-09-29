// backend/src/auth/telegramSign.ts
// Проверка подписи Telegram Mini Apps initData.
//
// Алгоритм (платформа Telegram, @tma.js/init-data-node):
// 1. initData — query-params строка (user, auth_date, query_id, hash).
// 2. HMAC-SHA256 секретным ключом бота (пары bot_token:secret через
//    хеш "WebAppData") по канонической строке отсортированных пар
//    ключ=значение — сравнивается с параметром hash.
// 3. Свежесть auth_date проверяется против expiresIn (анти-replay).
//
// Replay-кэш не нужен: initData законно живёт в клиенте всё время сессии
// Mini App и может предъявляться повторно в пределах TTL (перезапуск,
// догрузка). Свежесть ограничена окном expiresIn (анти-replay).
import {
  AuthDateInvalidError,
  ExpiredError,
  SignatureInvalidError,
  SignatureMissingError,
  parse,
  validate,
} from "@tma.js/init-data-node";
import { env } from "../env.js";
import { logger } from "../logger.js";

export interface TelegramInitUser {
  id: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
}

export interface TelegramAuthResult {
  isValid: boolean;
  telegramUserId?: bigint;
  /**
   * Подписанный Telegram объект user (часть валидированной initData):
   * источник display-данных профиля. После валидации подписи данным
   * можно доверять в идентификационных целях; display-обработка
   * (санитизация имени, allowlist хостов аватара) — в telegramProfile.ts.
   */
  user?: TelegramInitUser;
}

// Точное значение dev-хэша. Сравнение строгое (===) по распарсенному
// параметру hash: includes() по сырой строке открывал бы обход подстрокой
// в значении другого параметра.
const DEV_HASH = "dev-hash";

function extractUser(userJson: string | null): TelegramInitUser | null {
  if (!userJson) return null;
  try {
    const raw: unknown = JSON.parse(userJson);
    if (!raw || typeof raw !== "object") return null;
    const id = Reflect.get(raw, "id");
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      return null;
    }
    const user: TelegramInitUser = { id };
    const firstName = Reflect.get(raw, "first_name");
    if (typeof firstName === "string" && firstName.trim() !== "") {
      user.firstName = firstName;
    }
    const lastName = Reflect.get(raw, "last_name");
    if (typeof lastName === "string" && lastName.trim() !== "") {
      user.lastName = lastName;
    }
    const username = Reflect.get(raw, "username");
    if (typeof username === "string" && username.trim() !== "") {
      user.username = username;
    }
    const photoUrl = Reflect.get(raw, "photo_url");
    if (typeof photoUrl === "string" && photoUrl.trim() !== "") {
      user.photoUrl = photoUrl;
    }
    return user;
  } catch {
    return null;
  }
}

/**
 * Валидирует RAW initData Telegram Mini Apps.
 *
 * Клиент обязан передать строку ровно как её отдал Telegram (ключи не
 * пересортированы, значения не перекодированы) — иначе HMAC не сойдётся
 * (см. telegramAuthRequestSchema в @edem/contracts).
 *
 * Токен не задан + ALLOW_DEV_AUTH (dev/test) → dev-bypass: точное
 * совпадение hash=dev-hash и валидный user.id из JSON. Произвольный id
 * принимается — это одноразовый dev-инструмент,
 * в production ALLOW_DEV_AUTH всегда false, а реальная ветка требует
 * TELEGRAM_BOT_TOKEN. Вызывающий роут отвечает 503, если токен не задан
 * и dev-режим выключен (роут «не сконфигурирован» ≠ «невалидная подпись»).
 */
export function verifyTelegramInitData(
  rawInitData: string,
): TelegramAuthResult {
  // Dev-bypass: только вне production и только без реального токена.
  if (!env.TELEGRAM_BOT_TOKEN && env.ALLOW_DEV_AUTH && !env.isProduction) {
    const params = new URLSearchParams(rawInitData);
    if (params.get("hash") !== DEV_HASH) {
      return { isValid: false };
    }
    const user = extractUser(params.get("user"));
    if (!user) {
      return { isValid: false };
    }
    logger.warn(
      { env: env.NODE_ENV },
      "[Auth] DEV telegram initData bypass accepted",
    );
    return { isValid: true, telegramUserId: BigInt(user.id), user };
  }

  if (!env.TELEGRAM_BOT_TOKEN) {
    // Прод без токена (или dev без ALLOW_DEV_AUTH): роут должен был
    // ответить 503 до вызова — сюда попадаем только при рассинхроне.
    return { isValid: false };
  }

  try {
    validate(rawInitData, env.TELEGRAM_BOT_TOKEN, {
      expiresIn: env.TG_INIT_DATA_TTL_SECONDS,
    });
  } catch (error) {
    // Типизированные ошибки валидации — вина клиента → 401 (роут).
    // Нетипизированная ошибка — инфраструктура: логируем и тоже 401
    // (fail-closed, но видим проблему в мониторинге).
    const known =
      SignatureInvalidError.is(error) ||
      SignatureMissingError.is(error) ||
      AuthDateInvalidError.is(error) ||
      ExpiredError.is(error);
    if (!known) {
      logger.error(
        { err: error },
        "[Auth] Telegram initData validation failed unexpectedly",
      );
    }
    return { isValid: false };
  }

  // Типизация через структурную обёртку: генерики parse() дают разные
  // типы для прямого вызова и ReturnType (snake/camel-вариант), а нам
  // нужен только user — точную форму задаёт RawParsedUser ниже.
  let parsed: { user?: unknown };
  try {
    // parse() валидирует форму полей (valibot-схема пакета: у user
    // обязательны id и first_name) и может бросить на формально
    // подписанных, но нестандартных данных — fail-closed, это 401,
    // а не 500.
    parsed = parse(rawInitData);
  } catch {
    return { isValid: false };
  }
  // ВАЖНО: типы пакета обещают camelCase-поля, но runtime 2.0.10 отдаёт
  // snake_case (проверено напрямую). Приводим к собственному интерфейсу —
  // компилятору не доверяем, рантайм-формату доверяем.
  const rawUser = parsed.user as RawParsedUser | undefined;
  const user = rawUser ? fromParsedUser(rawUser) : null;
  if (!user) {
    // Подпись валидна, но user-объекта нет (например, initData из
    // inline-режима без user) — для auth это бесполезно.
    return { isValid: false };
  }

  return { isValid: true, telegramUserId: BigInt(user.id), user };
}

/**
 * Реальная (runtime) форма user-объекта из parse(): snake_case-поля
 * с__ telegram-параметров. Валидируется id и выкидываются пустые поля.
 */
interface RawParsedUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

function fromParsedUser(raw: RawParsedUser): TelegramInitUser | null {
  if (!Number.isSafeInteger(raw.id) || raw.id <= 0) {
    return null;
  }
  const result: TelegramInitUser = { id: raw.id };
  if (typeof raw.first_name === "string" && raw.first_name.trim() !== "") {
    result.firstName = raw.first_name;
  }
  if (typeof raw.last_name === "string" && raw.last_name.trim() !== "") {
    result.lastName = raw.last_name;
  }
  if (typeof raw.username === "string" && raw.username.trim() !== "") {
    result.username = raw.username;
  }
  if (typeof raw.photo_url === "string" && raw.photo_url.trim() !== "") {
    result.photoUrl = raw.photo_url;
  }
  return result;
}
