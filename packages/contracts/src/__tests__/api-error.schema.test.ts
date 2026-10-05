// Протокол ошибок API в контрактах.
//
// Здесь закреплено решение, из-за которого модуль и вынесен: клиент должен
// отличать удалённый аккаунт от забаненного ПО КОДУ. Раньше оба делили
// FORBIDDEN и различались текстом — переформулировка сообщения тихо уводила
// удалённого на экран бана с предложением апелляции, хотя при удалении
// восстановление невозможно.
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_DELETED_CODE,
  ACCOUNT_DELETED_MESSAGE,
  WS_TERMINAL_REASON,
  apiErrorSchema,
  isAccountDeletedError,
} from "../index.js";

describe("isAccountDeletedError", () => {
  it("узнаёт удаление по КОДУ — ради этого код и заведён", () => {
    expect(
      isAccountDeletedError({
        code: ACCOUNT_DELETED_CODE,
        message: "Любой текст, хоть переписанный",
      }),
    ).toBe(true);
  });

  it("узнаёт удаление по ТЕКСТУ старого бэка, но только если запись — конверт ошибки", () => {
    // Старый бэк делит код с баном, текст — единственный признак.
    expect(
      isAccountDeletedError({
        code: "FORBIDDEN",
        message: ACCOUNT_DELETED_MESSAGE,
      }),
    ).toBe(true);
  });

  it("бан — не удаление", () => {
    expect(
      isAccountDeletedError({
        code: "FORBIDDEN",
        message: "Account is banned",
        banReason: "Спам",
      }),
    ).toBe(false);
    // Чужой FORBIDDEN: «Reviews must be between driver and passenger».
    expect(
      isAccountDeletedError({
        code: "FORBIDDEN",
        message: "Reviews must be between driver and passenger",
      }),
    ).toBe(false);
  });

  it("запись без code — не протокольный ответ, даже с нужным текстом", () => {
    // Голый Error: .message есть, .code нет вовсе. Такой текст мог прийти
    // откуда угодно и не должен выдавать себя за ответ бэка.
    expect(isAccountDeletedError(new Error(ACCOUNT_DELETED_MESSAGE))).toBe(false);
    expect(
      isAccountDeletedError({ message: ACCOUNT_DELETED_MESSAGE }),
    ).toBe(false);
  });

  it("не падает на мусоре", () => {
    expect(isAccountDeletedError(null)).toBe(false);
    expect(isAccountDeletedError(undefined)).toBe(false);
    expect(isAccountDeletedError(ACCOUNT_DELETED_MESSAGE)).toBe(false);
    expect(isAccountDeletedError(403)).toBe(false);
    expect(isAccountDeletedError({})).toBe(false);
    expect(isAccountDeletedError({ code: 42, message: 7 })).toBe(false);
  });
});

describe("причины закрытия WS (4403)", () => {
  it("у удаления их ДВЕ — различаются на «is»", () => {
    // ws/index.ts (ws-auth) и users/index.ts (DELETE /me). Одна строка не
    // покрыла бы самоудаление — самый частый случай.
    expect(WS_TERMINAL_REASON.deletedByWsAuth).toBe(ACCOUNT_DELETED_MESSAGE);
    expect(WS_TERMINAL_REASON.deletedBySelf).toBe("Account deleted");
    expect(WS_TERMINAL_REASON.banned).toBe("Account is banned");
  });
});

describe("конверт ошибки API", () => {
  it("принимает минимальный и полный конверт", () => {
    expect(
      apiErrorSchema.parse({
        code: ACCOUNT_DELETED_CODE,
        message: ACCOUNT_DELETED_MESSAGE,
      }),
    ).toEqual({
      code: ACCOUNT_DELETED_CODE,
      message: ACCOUNT_DELETED_MESSAGE,
    });
    expect(
      apiErrorSchema.parse({
        code: "CONFLICT",
        message: "Already exists",
        errors: { field: "taken" },
        retryable: true,
      }).retryable,
    ).toBe(true);
  });

  it("code обязателен: без него клиент не сможет принять решение", () => {
    expect(
      apiErrorSchema.safeParse({ message: ACCOUNT_DELETED_MESSAGE }).success,
    ).toBe(false);
  });
});
