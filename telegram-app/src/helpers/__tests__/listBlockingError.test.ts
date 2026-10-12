import { describe, expect, it } from "vitest";
import { listBlockingError } from "@/helpers/listBlockingError";

/**
 * Регресс M1: сбой догрузкистраницы стирал уже прочитанный список.
 *
 * React Query держит `data` при ошибке, но переключает `status` в `error`,
 * а `QueryState` проверяет `error` раньше `children`. Поэтому падение ОДНОЙ
 * следующей страницы (обычное дело в мобильной сети) выкидывало на экран
 * «Ошибка загрузки» и первые страницы вместе с ними — на мобильном интернете
 * это 20–40 уже прочитанных карточек плюс форма поиска.
 */
const error = new Error("network down");

describe("listBlockingError", () => {
  it("первая страница не пришла — ошибка блокирует список", () => {
    // Показывать нечего: зовём пользователя повторить.
    expect(listBlockingError({ error, data: undefined })).toBe(error);
    expect(listBlockingError({ error, data: { pages: [] } })).toBe(error);
  });

  it("часть ленты загружена — ошибка НЕ блокирует, контент остаётся", () => {
    expect(
      listBlockingError({ error, data: { pages: [{ items: [] }, { items: [] }] } }),
    ).toBeNull();
  });

  it("без ошибки всегда null — обычный путь не меняется", () => {
    expect(listBlockingError({ error: null, data: { pages: [{}] } })).toBeNull();
    expect(listBlockingError({ error: null, data: undefined })).toBeNull();
  });
});
