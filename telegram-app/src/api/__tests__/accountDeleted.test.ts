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
    // Регрессия, которую чуть не упустили: проверка стояла ВНУТРИ
    // «code === FORBIDDEN», и с новым кодом удаления emitDeleted не
    // вызывался вовсе — удалённый уезжал на экран логина.
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
    expect(isAccountDeletedError({ code: ACCOUNT_DELETED_CODE, message: "x" })).toBe(true);
    expect(isAccountDeletedError({ message: ACCOUNT_DELETED_MESSAGE })).toBe(true);
  });
});

describe("контракт с бэкендом", () => {
  it("код ACCOUNT_DELETED есть в backend/src/errors.ts", () => {
    expect(readRepoFile("backend/src/errors.ts")).toContain(
      `ACCOUNT_DELETED: "${ACCOUNT_DELETED_CODE}"`,
    );
  });

  it("текст удаления в бэке — ровно один, и он равен константе клиента", () => {
    const sources = [
      "backend/src/auth/middleware.ts",
      "backend/src/auth/index.ts",
      "backend/src/feedback/index.ts",
    ];
    for (const file of sources) {
      expect(readRepoFile(file)).toContain("ACCOUNT_DELETED_MESSAGE");
    }
    // Единственное место, где текст живёт как литерал, — errors.ts.
    expect(readRepoFile("backend/src/errors.ts")).toContain(
      `= "${ACCOUNT_DELETED_MESSAGE}"`,
    );
    expect(
      sources.filter((file) => readRepoFile(file).includes(`"${ACCOUNT_DELETED_MESSAGE}"`)),
    ).toEqual([]);
  });

  it("WS-причины совпадают с исходниками бэка (иначе экран уедет в «бан»)", () => {
    // Причина закрытия WS — свободная строка, машинного кода там нет.
    // Поэтому таблицу проверяем чтением бэка: переименование на сервере
    // должно ронять этот тест, а не молча уводить удалённого в бан.
    expect(readRepoFile("backend/src/ws/index.ts")).toContain(
      `"${WS_TERMINAL_REASON.deletedByWsAuth}"`,
    );
    expect(readRepoFile("backend/src/users/index.ts")).toContain(
      `"${WS_TERMINAL_REASON.deletedBySelf}"`,
    );
    expect(readRepoFile("backend/src/ws/index.ts")).toContain(
      `"${WS_TERMINAL_REASON.banned}"`,
    );
  });

  it("в прикладном коде telegram-app нет сырых строк протокола", () => {
    // Раньше литерал «Account is deleted» жил в VehicleModal и
    // WebSocketProvider — обе копии молча уводили экран в «бан».
    //
    // Комментарии режем: они объясняют, откуда строки, и это законная
    // документация. `//` снимаем только в начале строки — иначе «съел» бы
    // хвост строки с URL вида "https://…" и мог спрятать литерал.
    const stripComments = (code: string): string =>
      code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const walk = (dir: string): string[] =>
      readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === "__tests__" ? [] : walk(rel);
        return /\.tsx?$/.test(entry.name) && rel !== "telegram-app/src/api/client.ts"
          ? [rel]
          : [];
      });
    const needles = [
      ACCOUNT_DELETED_MESSAGE,
      WS_TERMINAL_REASON.deletedBySelf,
      WS_TERMINAL_REASON.banned,
    ];
    const offenders = walk("telegram-app/src").filter((file) => {
      const code = stripComments(readRepoFile(file));
      return needles.some((needle) => code.includes(`"${needle}"`));
    });
    expect(offenders).toEqual([]);
  });
});
