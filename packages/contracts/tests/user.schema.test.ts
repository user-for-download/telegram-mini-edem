import { describe, it, expect } from "vitest";
import {
  userSchema,
  carSchema,
  completeOnboardingBodySchema,
} from "../src/schemas/user.schema";

describe("userSchema", () => {
  const validUser = {
    id: "u-1",
    name: "Илья Северов",
    avatar: "https://i.pravatar.cc/200?img=12",
    rating: 4.9,
    reviewsCount: 34,
    tripsCount: 58,
    isVerified: true,
    car: { model: "Skoda Octavia", color: "белый", plate: "А 217 МК 78" },
    about: "За рулём 7 лет",
  };

  it("should parse valid user", () => {
    const result = userSchema.safeParse(validUser);
    expect(result.success).toBe(true);
  });

  it("should reject user with empty name", () => {
    const result = userSchema.safeParse({ ...validUser, name: "" });
    expect(result.success).toBe(false);
  });

  it("should reject user with rating > 5", () => {
    const result = userSchema.safeParse({ ...validUser, rating: 6 });
    expect(result.success).toBe(false);
  });

  it("should reject user with invalid avatar URL", () => {
    const result = userSchema.safeParse({ ...validUser, avatar: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("should parse user with onboardingVersion string", () => {
    const result = userSchema.safeParse({ ...validUser, onboardingVersion: "1" });
    expect(result.success).toBe(true);
  });

  it("should parse user with onboardingVersion null (reset or not set)", () => {
    const result = userSchema.safeParse({ ...validUser, onboardingVersion: null });
    expect(result.success).toBe(true);
  });

  it("should parse user without onboardingVersion (field optional)", () => {
    const { onboardingVersion: _omitted, ...withoutVersion } = {
      ...validUser,
      onboardingVersion: "1",
    };
    const result = userSchema.safeParse(withoutVersion);
    expect(result.success).toBe(true);
  });

  it("should reject user with non-string onboardingVersion", () => {
    const result = userSchema.safeParse({ ...validUser, onboardingVersion: 1 });
    expect(result.success).toBe(false);
  });
});

describe("completeOnboardingBodySchema", () => {
  it("should parse valid version", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: "1" });
    expect(result.success).toBe(true);
  });

  it("should trim surrounding whitespace", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: " 2 " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe("2");
    }
  });

  it("should parse version of exactly 50 characters (boundary)", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: "a".repeat(50) });
    expect(result.success).toBe(true);
  });

  it("should reject empty version", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: "" });
    expect(result.success).toBe(false);
  });

  it("should reject whitespace-only version (trim before min-length)", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: "   " });
    expect(result.success).toBe(false);
  });

  it("should reject version longer than 50 characters", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: "a".repeat(51) });
    expect(result.success).toBe(false);
  });

  it("should reject missing version", () => {
    const result = completeOnboardingBodySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("should reject non-string version", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: 1 });
    expect(result.success).toBe(false);
  });

  it("should reject extra fields (strict)", () => {
    const result = completeOnboardingBodySchema.safeParse({ version: "1", extra: true });
    expect(result.success).toBe(false);
  });
});

describe("carSchema", () => {
  it("should parse valid car", () => {
    const result = carSchema.safeParse({
      model: "Skoda Octavia",
      color: "белый",
      plate: "А 217 МК 78",
    });
    expect(result.success).toBe(true);
  });

  it("should reject car with empty model", () => {
    const result = carSchema.safeParse({ model: "", color: "белый", plate: "А 217 МК 78" });
    expect(result.success).toBe(false);
  });
});
