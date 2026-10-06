// Контракт различения «удалён / забанен».
//
// Историческая боль: удаление и бан делили код FORBIDDEN, и клиент отличал
// их ТОЛЬКО по тексту. Стоило бэку переформулировать «Account is deleted» —
// и удалённый аккаунт молча уезжал на плашку бана с предложением
// обжалования, хотя при удалении восстановление невозможно. Две копии
// сравнения к тому же забыли про константу (VehicleModal, WebSocketProvider).
//
// Теперь бэк отдаёт отдельный код ACCOUNT_DELETED, а решает всё одна
// функция isAccountDeletedError. Здесь закреплены все три её грани.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCOUNT_DELETED_CODE,
  ACCOUNT_DELETED_MESSAGE,
  ApiClient,
  ApiError,
  WS_TERMINAL_REASON,
  isAccountDeletedError,
} from "@/api/client";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const readRepoFile = (rel: string): string =>
  readFileSync(join(repoRoot, rel), "utf8");

describe("isAccountDeletedError", () => {
  it("узнаёт удаление по КОДУ — ради этого ветка и вынесена", () => {
    expect(
      isAccountDeletedError(
        new ApiError("Любой текст, хоть переписанный", ACCOUNT_DELETED_CODE, 403),
      ),
    ).toBe(true);
  });

  it("узнаёт удаление по ТЕКСТУ — фолбэк для старого бэка", () => {
    expect(
      isAccountDeletedError(new ApiError(ACCOUNT_DELETED_MESSAGE, "FORBIDDEN", 403)),
    ).toBe(true);
  });

  it("бан — не удаление, даже с 403 и текстом рядом", () => {
    expect(isAccountDeletedError(new ApiError("Account is banned", "FORBIDDEN", 403))).toBe(
      false,
    );
    expect(isAccountDeletedError(new ApiError("Reviews must be…", "FORBIDDEN", 403))).toBe(
      false,
    );
  });

  it("не падает на мусоре: null, строки, Error, чужие коды", () => {
    expect(isAccountDeletedError(null)).toBe(false);
    expect(isAccountDeletedError(undefined)).toBe(false);
    expect(isAccountDeletedError("Account is deleted")).toBe(false);
    expect(isAccountDeletedError(new Error("Account is deleted"))).toBe(false);
    expect(isAccountDeletedError(new ApiError("…", "NOT_FOUND", 404))).toBe(false);
  });
});

describe("refresh: 403 удалённого аккаунта", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const runRefresh = async (body: unknown) => {
    const client = new ApiClient();
    client.setSession({ accessToken: "access", refreshToken: "refresh" });
    const deleted: string[] = [];
    const banned: string[] = [];
    let expired = 0;
    client.onDeleted(() => deleted.push("deleted"));
    client.onBanned(() => banned.push("banned"));
    client.onSessionExpired(() => (expired += 1));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(body), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const result = await client.tryRefresh();
    return { result, deleted, banned, expired };
  };

  it("НОВЫЙ код → emitDeleted, а не тихий session-expired", async () => {
    // Проверка удаления стоит ВНЕ «code === FORBIDDEN»: иначе с кодом
    // ACCOUNT_DELETED emitDeleted не вызывался бы, и удалённый уезжал
    // бы на экран логина.
    const { result, deleted, banned, expired } = await runRefresh({
      code: ACCOUNT_DELETED_CODE,
      message: ACCOUNT_DELETED_MESSAGE,
    });
    expect(result).toBe("permanent-rejection");
    expect(deleted).toHaveLength(1);
    expect(banned).toHaveLength(0);
    expect(expired).toBe(1);
  });

  it("СТАРЫЙ FORBIDDEN + текст → тоже emitDeleted (совместимость)", async () => {
    const { deleted, banned } = await runRefresh({
      code: "FORBIDDEN",
      message: ACCOUNT_DELETED_MESSAGE,
    });
    expect(deleted).toHaveLength(1);
    expect(banned).toHaveLength(0);
  });

  it("FORBIDDEN бана → emitBanned, НЕ emitDeleted", async () => {
    const { deleted, banned } = await runRefresh({
      code: "FORBIDDEN",
      message: "Account is banned",
      banReason: "Спам",
    });
    expect(banned).toHaveLength(1);
    expect(deleted).toHaveLength(0);
  });
});

describe("isAccountDeletedError: сырое тело ответа", () => {
  it("в ветке refresh до ApiError не доходит — принимает и запись", () => {
    // Тело ответа бэка всегда с code (все шесть точек его шлют), поэтому
    // фолбэк по тексту и требует code: голый Error без code не считается
    // протокольным ответом — иначе любая ошибка с таким текстом выдавала
    // бы себя за удалённый аккаунт.
    expect(isAccountDeletedError({ code: ACCOUNT_DELETED_CODE, message: "x" })).toBe(true);
    expect(isAccountDeletedError({ code: "FORBIDDEN", message: ACCOUNT_DELETED_MESSAGE })).toBe(
      true,
    );
    expect(isAccountDeletedError({ message: ACCOUNT_DELETED_MESSAGE })).toBe(false);
  });
});

describe("контракт с бэкендом", () => {
  it("бэк берёт код и текст удаления ИЗ контрактов, а не пишет литералом", () => {
    // Единственный дом — @edem/contracts: бэк импортирует, и сверять
    // нечего — расхождение невозможно по построению.
    const errors = readRepoFile("backend/src/errors.ts");
    expect(errors).toContain("ACCOUNT_DELETED: ACCOUNT_DELETED_CODE");
    expect(errors).toContain(
      'import { ACCOUNT_DELETED_CODE } from "@edem/contracts"',
    );
    expect(errors).not.toContain(`"${ACCOUNT_DELETED_CODE}"`);
    expect(errors).not.toContain(`"${ACCOUNT_DELETED_MESSAGE}"`);
    expect(errors).toContain(
      'export { ACCOUNT_DELETED_MESSAGE } from "@edem/contracts"',
    );
  });

  it("WS-причины в бэке берутся из контрактов, а не пишутся строкой", () => {
    // У close-кадра нет поля code, поэтому причина — строка, но одна
    // на обе стороны.
    for (const file of [
      "backend/src/ws/index.ts",
      "backend/src/users/index.ts",
      "backend/src/admin/index.ts",
    ]) {
      const source = readRepoFile(file);
      expect(source).toContain("WS_TERMINAL_REASON");
      for (const needle of [
        WS_TERMINAL_REASON.deletedByWsAuth,
        WS_TERMINAL_REASON.deletedBySelf,
        WS_TERMINAL_REASON.banned,
      ]) {
        expect(source).not.toContain(`"${needle}"`);
      }
    }
  });

  it("во всём приложении нет сырых строк протокола — единственный дом контракты", () => {
    // Проверяем ОБЕ стороны (бэк и клиент) и приложение целиком: единственное
    // разрешённое место — packages/contracts/src/schemas/api-error.schema.ts.
    //
    // Комментарии режем: они объясняют, откуда строки, и это законная
    // документация. `//` снимаем только в начале строки — иначе «съел» бы
    // хвост строки с URL вида "https://…" и мог спрятать литерал.
    const stripComments = (code: string): string =>
      code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const walk = (dir: string): string[] =>
      readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          return entry.name === "__tests__" || entry.name === "dist" ? [] : walk(rel);
        }
        return /\.tsx?$/.test(entry.name) ? [rel] : [];
      });
    const CONTRACT_HOME = "packages/contracts/src/schemas/api-error.schema.ts";
    // Только ПРИЗНАКИ, по которым клиент что-то различает. Строка «Account is
    // banned» сюда НЕ входит намеренно: в HTTP-ответах бэка она идёт как
    // `message` — свободный человекочитаемый текст, который по контракту не
    // часть протокола (клиент показывает свои формулировки по коду и бан
    // определяет исключением из удаления). Запрещать её в бэке нельзя, это
    // сломало бы честные сообщения об ошибке.
    //
    // Плюс «Account deleted» (WS-причина самоудаления) и код — их клиент
    // действительно различает, поэтому копия в прикладном коде опасна.
    const needles = [
      ACCOUNT_DELETED_CODE,
      ACCOUNT_DELETED_MESSAGE,
      WS_TERMINAL_REASON.deletedBySelf,
    ];
    const offenders = [
      ...walk("telegram-app/src"),
      ...walk("backend/src"),
      ...walk("packages/contracts/src"),
    ]
      .filter((file) => file !== CONTRACT_HOME)
      .filter((file) => {
        const code = stripComments(readRepoFile(file));
        return needles.some((needle) => code.includes(`"${needle}"`));
      });
    expect(offenders).toEqual([]);
  });
});
