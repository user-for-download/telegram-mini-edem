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

  it("принимает корректный телефон, отклоняет мусор", () => {
    expect(validateProfileForm("Анна", "", "+7 900 123-45-67")).toBeNull();
    expect(validateProfileForm("Анна", "", "не номер")).toBe(
      "Телефон: 7–15 цифр, можно с + в начале",
    );
    expect(validateProfileForm("Анна", "", "+123")).toBe(
      "Телефон: 7–15 цифр, можно с + в начале",
    );
  });
});

describe("normalizeProfileForm", () => {
  it("тримит имя и «О себе»", () => {
    expect(normalizeProfileForm("  Анна  ", "  текст  ")).toEqual({
      name: "Анна",
      about: "текст",
      phone: null,
    });
  });

  it("пустое «О себе» — явный null (backend очищает поле)", () => {
    expect(normalizeProfileForm("Анна", "   ")).toEqual({
      name: "Анна",
      about: null,
      phone: null,
    });
  });

  it("телефон тримится, пустой — null", () => {
    expect(normalizeProfileForm("Анна", "", "  +79001234567  ")).toEqual({
      name: "Анна",
      about: null,
      phone: "+79001234567",
    });
  });
});
