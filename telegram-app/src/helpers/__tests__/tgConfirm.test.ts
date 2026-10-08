// @vitest-environment jsdom
// telegram-app/src/helpers/__tests__/tgConfirm.test.ts
// Цепочка подтверждения из трёх уровней: диалог клиента → window.confirm →
// «спросить не удалось» = true. Последний уровень проверен отдельно на
// поведении jsdom (window.confirm не реализован), потому что трактовка
// undefined как «отказ» тихо ломала бы создание заявки.
import { afterEach, describe, expect, it, vi } from "vitest";
import { tgConfirm } from "@/helpers/tgConfirm";

const MESSAGE = "Уже есть подходящие поездки. Всё равно создать заявку?";

/**
 * Диалог клиента: метод кладётся на объект WebApp, как его кладёт настоящий
 * клиент, — хелпер ищет его там, а не в версии пакета.
 */
function stubClientConfirm(impl: () => unknown) {
  const showConfirm = vi.fn(impl);
  vi.stubGlobal("Telegram", { WebApp: { showConfirm } });
  return showConfirm;
}

/**
 * Браузерный диалог. Заглушка вешается прямо на `window`, а не через
 * stubGlobal: хелпер читает `window.confirm`, и подменять надо тот же
 * объект (паттерн window.scrollTo в useScrollRestore.dom.test.tsx).
 */
function stubBrowserConfirm(impl: () => boolean) {
  const confirm = vi.fn(impl);
  Object.defineProperty(window, "confirm", {
    value: confirm,
    writable: true,
    configurable: true,
  });
  return confirm;
}

// Родной window.confirm (в jsdom он не реализован) — чтобы вернуть его в
// послесловии, иначе заглушка предыдущего теста утечёт в следующий.
const NATIVE_CONFIRM = window.confirm;

afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "confirm", {
    value: NATIVE_CONFIRM,
    writable: true,
    configurable: true,
  });
});

describe("tgConfirm: уровень 1 — диалог клиента", () => {
  it("возвращает отказ пользователя и не спрашивает браузер", async () => {
    // Arrange
    const showConfirm = stubClientConfirm(() => false);
    const confirm = stubBrowserConfirm(() => true);

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(showConfirm).toHaveBeenCalledTimes(1);
  });

  it("возвращает согласие пользователя", async () => {
    // Arrange
    stubClientConfirm(() => true);
    stubBrowserConfirm(() => false);

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(true);
  });

  it("передаёт текст сообщения в метод клиента", async () => {
    // Arrange
    const showConfirm = stubClientConfirm(() => true);

    // Act
    await tgConfirm(MESSAGE);

    // Assert
    expect(showConfirm).toHaveBeenCalledWith(MESSAGE);
  });

  it("не-boolean из метода клиента трактуется как «не спросили»", async () => {
    // Arrange: метод клиента без нашей колбэк-обвязки может вернуть что угодно.
    stubClientConfirm(() => undefined);
    const confirm = stubBrowserConfirm(() => false);

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert: ответа нет — согласия нет, даже если браузер бы согласился.
    expect(result).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("исключение метода клиента трактуется как «не спросили»", async () => {
    // Arrange
    stubClientConfirm(() => {
      throw new Error("WebView is closing");
    });

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(false);
  });
});

describe("tgConfirm: уровень 2 — window.confirm", () => {
  it("без метода клиента уважает отказ в браузере", async () => {
    // Arrange: клиента нет (обычный браузер) — цепочка идёт уровнем ниже.
    stubBrowserConfirm(() => false);

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(false);
  });

  it("без метода клиента уважает согласие в браузере", async () => {
    // Arrange
    const confirm = stubBrowserConfirm(() => true);

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(true);
    expect(confirm).toHaveBeenCalledWith(MESSAGE);
  });
});

describe("tgConfirm: уровень 3 — подтверждения нет", () => {
  it("undefined из window.confirm (jsdom) трактуется как отсутствие согласия", async () => {
    // Arrange: так ведёт себя jsdom — диалога нет, метод вернул undefined.
    stubBrowserConfirm(() => undefined as unknown as boolean);

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(false);
  });

  it("бросивший window.confirm трактуется как отсутствие согласия", async () => {
    // Arrange
    stubBrowserConfirm(() => {
      throw new Error("Not implemented: window.confirm");
    });

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(false);
  });

  it("без window (SSR) согласие не выпрашивается", async () => {
    // Arrange
    vi.stubGlobal("window", undefined);

    // Act
    const result = await tgConfirm(MESSAGE);

    // Assert
    expect(result).toBe(false);
  });
});
