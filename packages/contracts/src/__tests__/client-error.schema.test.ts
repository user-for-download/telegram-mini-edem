import { describe, expect, it } from "vitest";
import {
  CLIENT_ERROR_COMPONENT_STACK_MAX_LENGTH,
  CLIENT_ERROR_MESSAGE_MAX_LENGTH,
  CLIENT_ERROR_RELEASE_MAX_LENGTH,
  CLIENT_ERROR_ROUTE_MAX_LENGTH,
  CLIENT_ERROR_STACK_MAX_LENGTH,
  clientErrorSchema,
} from "../index.js";

/**
 * Контракт POST /api/v1/client-errors: kind строго из трёх значений,
 * длины полей ограничены (защита публичного эндпоинта от спама).
 */
describe("client-error contracts", () => {
  const valid = {
    kind: "error",
    message: "Cannot read properties of undefined",
    stack: "TypeError: Cannot read...\n    at App (app.js:10:5)",
    route: "/search",
    release: "1.2.3",
  };

  it("принимает полный валидный отчёт", () => {
    expect(clientErrorSchema.parse(valid)).toEqual(valid);
  });

  it("принимает минимальный отчёт (только kind + message)", () => {
    expect(
      clientErrorSchema.parse({ kind: "boundary", message: "boom" }),
    ).toEqual({ kind: "boundary", message: "boom" });
  });

  it("отклоняет неизвестный kind", () => {
    expect(
      clientErrorSchema.safeParse({ ...valid, kind: "server" }).success,
    ).toBe(false);
  });

  it("отклоняет пустое message", () => {
    expect(
      clientErrorSchema.safeParse({ kind: "error", message: "" }).success,
    ).toBe(false);
  });

  it("отклоняет превышение лимитов длин", () => {
    const over = {
      kind: "error",
      message: "x".repeat(CLIENT_ERROR_MESSAGE_MAX_LENGTH + 1),
    };
    expect(clientErrorSchema.safeParse(over).success).toBe(false);
    expect(
      clientErrorSchema.safeParse({
        ...valid,
        stack: "x".repeat(CLIENT_ERROR_STACK_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      clientErrorSchema.safeParse({
        ...valid,
        componentStack: "x".repeat(
          CLIENT_ERROR_COMPONENT_STACK_MAX_LENGTH + 1,
        ),
      }).success,
    ).toBe(false);
    expect(
      clientErrorSchema.safeParse({
        ...valid,
        route: "x".repeat(CLIENT_ERROR_ROUTE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      clientErrorSchema.safeParse({
        ...valid,
        release: "x".repeat(CLIENT_ERROR_RELEASE_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("принимает значения ровно на границе лимитов", () => {
    expect(
      clientErrorSchema.safeParse({
        kind: "unhandledrejection",
        message: "x".repeat(CLIENT_ERROR_MESSAGE_MAX_LENGTH),
        stack: "x".repeat(CLIENT_ERROR_STACK_MAX_LENGTH),
        route: "x".repeat(CLIENT_ERROR_ROUTE_MAX_LENGTH),
        release: "x".repeat(CLIENT_ERROR_RELEASE_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });
});
