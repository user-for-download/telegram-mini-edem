import { describe, expect, it } from "vitest";
import { normalizeProfileForm, validateProfileForm } from "@/pages/Profile/profileValidation";

describe("validateProfileForm (порт EditProfileModal)", () => {
  it("принимает корректные имя и «О себе»", () => {
    expect(validateProfileForm("Анна", "Люблю дальние поездки")).toBeNull();
  });

  it("отклоняет имя короче 2 символов (включая пробельное)", () => {
    expect(validateProfileForm("A", "")).toBe("Имя должно содержать минимум 2 символа");
    expect(validateProfileForm("   ", "")).toBe("Имя должно содержать минимум 2 символа");
  });

  it("отклоняет имя длиннее 100 символов", () => {
    expect(validateProfileForm("а".repeat(101), "")).toBe("Имя не может быть длиннее 100 символов");
  });

  it("отклоняет «О себе» длиннее 500 символов", () => {
    expect(validateProfileForm("Анна", "x".repeat(501))).toBe(
      "Поле «О себе» не может быть длиннее 500 символов",
    );
  });
});

describe("normalizeProfileForm", () => {
  it("тримит имя и «О себе»", () => {
    expect(normalizeProfileForm("  Анна  ", "  текст  ")).toEqual({ name: "Анна", about: "текст" });
  });

  it("пустое «О себе» не отправляет (backend хранит прежнее)", () => {
    expect(normalizeProfileForm("Анна", "   ")).toEqual({ name: "Анна" });
  });
});
