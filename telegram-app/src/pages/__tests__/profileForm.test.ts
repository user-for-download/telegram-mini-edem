import { describe, expect, it } from "vitest";

/** Текст ошибки — как возвращал прежний validateProfileForm. */
const msg = (name: string, about: string, phone?: string) =>
  validateProfileFields(name, about, phone)?.message ?? null;
import {
  normalizeProfileForm,
  validateProfileFields,
} from "@/pages/Profile/profileValidation";

describe("validateProfileFields (порт EditProfileModal)", () => {
  it("принимает корректные имя и «О себе»", () => {
    expect(msg("Анна", "Люблю дальние поездки")).toBeNull();
  });

  it("отклоняет имя короче 2 символов (включая пробельное)", () => {
    expect(msg("A", "")).toBe("Имя должно содержать минимум 2 символа");
    expect(msg("   ", "")).toBe("Имя должно содержать минимум 2 символа");
  });

  it("отклоняет имя длиннее 100 символов", () => {
    expect(msg("а".repeat(101), "")).toBe("Имя не может быть длиннее 100 символов");
  });

  it("отклоняет «О себе» длиннее 500 символов", () => {
    expect(msg("Анна", "x".repeat(501))).toBe(
      "Поле «О себе» не может быть длиннее 500 символов",
    );
  });

  it("принимает корректный телефон, отклоняет мусор", () => {
    expect(msg("Анна", "", "+7 900 123-45-67")).toBeNull();
    expect(msg("Анна", "", "не номер")).toBe(
      "Телефон: 7–15 цифр, можно с + в начале",
    );
    expect(msg("Анна", "", "+123")).toBe(
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

describe("validateProfileFields: ошибка привязана к полю", () => {
  it("возвращает id поля, а не только текст", () => {
    // Основание правки 2026-10-02: текст без поля невозможно показать рядом
    // с полем — ошибка уезжала в общий Notice, а aria-invalid не ставился.
    expect(validateProfileFields("A", "")).toEqual({
      field: "profile-name",
      message: "Имя должно содержать минимум 2 символа",
    });
    expect(validateProfileFields("Анна", "x".repeat(501))).toEqual({
      field: "profile-about",
      message: "Поле «О себе» не может быть длиннее 500 символов",
    });
    expect(validateProfileFields("Анна", "", "не номер")).toEqual({
      field: "profile-phone",
      message: "Телефон: 7–15 цифр, можно с + в начале",
    });
    expect(validateProfileFields("Анна", "ок")).toBeNull();
  });
});
