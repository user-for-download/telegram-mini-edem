import { describe, it, expect } from "vitest";
import {
  adminBookingsQuerySchema,
  adminFeedbackQuerySchema,
  adminReviewsQuerySchema,
  adminTripsQuerySchema,
  adminUsersQuerySchema,
  banUserBodySchema,
} from "../src/schemas/admin.schema";
import {
  adminBookingDetailDtoSchema,
  adminDashboardDtoSchema,
  adminReviewDetailDtoSchema,
  adminTelegramMetricsDtoSchema,
  adminTelegramStopResponseDtoSchema,
  adminTripDetailDtoSchema,
  adminUserDetailDtoSchema,
  adminUserDtoSchema,
} from "../src/dto/admin.dto";
import { bannedErrorSchema } from "../src/dto/auth.dto";

describe("banUserBodySchema", () => {
  it("should parse valid reason", () => {
    // Arrange
    const body = { reason: "Спам в чатах" };

    // Act
    const result = banUserBodySchema.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("Спам в чатах");
    }
  });

  it("should trim surrounding whitespace on parse", () => {
    // Arrange
    const body = { reason: "  Спам  " };

    // Act
    const result = banUserBodySchema.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("Спам");
    }
  });

  it("should reject missing reason", () => {
    // Act
    const result = banUserBodySchema.safeParse({});

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject empty reason", () => {
    // Act
    const result = banUserBodySchema.safeParse({ reason: "" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject whitespace-only reason (trim before min-length)", () => {
    // Act
    const result = banUserBodySchema.safeParse({ reason: "   \t\n " });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should accept reason of exactly 500 characters (boundary)", () => {
    // Arrange
    const body = { reason: "a".repeat(500) };

    // Act
    const result = banUserBodySchema.safeParse(body);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject reason longer than 500 characters", () => {
    // Arrange
    const body = { reason: "a".repeat(501) };

    // Act
    const result = banUserBodySchema.safeParse(body);

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject non-string reason", () => {
    // Act
    const result = banUserBodySchema.safeParse({ reason: 1 });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject extra fields (strict)", () => {
    // Act
    const result = banUserBodySchema.safeParse({
      reason: "Спам",
      bannedAt: "2026-08-27T00:00:00.000Z",
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminUserDtoSchema — banReason", () => {
  const baseUser = {
    id: "u-1",
    name: "Иван Петров",
    avatar: "https://i.pravatar.cc/200?img=12",
    rating: 4.5,
    tripsCount: 10,
    reviewsCount: 4,
    isVerified: false,
    bannedAt: null,
    telegramUserId: "123456789",
    telegramConnected: true,
    tgChatJoinedAt: "2026-08-01T10:00:00.000Z",
    consentAcceptedAt: "2026-08-01T09:59:00.000Z",
    phone: "+79990000000",
    createdAt: "2026-08-27T00:00:00.000Z",
  };

  it("should parse user with banReason string (active ban)", () => {
    // Act
    const result = adminUserDtoSchema.safeParse({
      ...baseUser,
      banReason: "Спам в чатах",
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should parse user with banReason null (no ban or legacy ban without reason)", () => {
    // Act
    const result = adminUserDtoSchema.safeParse({ ...baseUser, banReason: null });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject user with missing banReason (required field)", () => {
    const { banReason: _omitted, ...rest } = { ...baseUser, banReason: null };
    // Act
    const result = adminUserDtoSchema.safeParse(rest);

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject user with non-nullable non-string banReason", () => {
    // Act
    const result = adminUserDtoSchema.safeParse({ ...baseUser, banReason: 123 });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminUserDtoSchema — Telegram and consent fields", () => {
  const baseUser = {
    id: "u-1",
    name: "Иван Петров",
    avatar: "https://i.pravatar.cc/200?img=12",
    rating: 4.5,
    tripsCount: 10,
    reviewsCount: 4,
    isVerified: false,
    bannedAt: null,
    banReason: null,
    telegramUserId: null,
    telegramConnected: false,
    tgChatJoinedAt: null,
    consentAcceptedAt: null,
    phone: null,
    createdAt: "2026-08-27T00:00:00.000Z",
  };

  it("should accept a user without Telegram consent or phone", () => {
    // Act
    const result = adminUserDtoSchema.safeParse(baseUser);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should require telegramConnected (derived field)", () => {
    const { telegramConnected: _omitted, ...rest } = baseUser;

    // Act
    const result = adminUserDtoSchema.safeParse(rest);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminUserDetailDtoSchema", () => {
  const user = {
    id: "u-1",
    name: "Иван Петров",
    avatar: "https://i.pravatar.cc/200?img=12",
    rating: 4.5,
    tripsCount: 10,
    reviewsCount: 4,
    isVerified: false,
    bannedAt: null,
    banReason: null,
    telegramUserId: "123456789",
    telegramConnected: true,
    tgChatJoinedAt: "2026-08-01T10:00:00.000Z",
    consentAcceptedAt: "2026-08-01T09:59:00.000Z",
    phone: "+79990000000",
    createdAt: "2026-08-27T00:00:00.000Z",
  };

  const trip = {
    id: "t-1",
    fromCity: "Москва",
    toCity: "Тула",
    fromAddress: "Тверская, 1",
    toAddress: "Ленина, 1",
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    status: "active",
    departureAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-08-27T00:00:00.000Z",
    driverName: "Иван Петров",
    driverId: "u-1",
  };

  const booking = {
    id: "b-1",
    seat: 1,
    status: "confirmed",
    createdAt: "2026-08-27T00:00:00.000Z",
    tripId: "t-1",
    tripRoute: "Москва → Тула",
    passengerId: "u-1",
    passengerName: "Иван Петров",
  };

  const feedback = {
    id: "f-1",
    subject: "Вопрос",
    text: "Текст обращения",
    reply: null,
    repliedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
    userId: "u-1",
    userName: "Иван Петров",
  };

  const report = {
    id: "r-1",
    targetType: "user" as const,
    targetId: "u-2",
    category: "spam" as const,
    status: "pending" as const,
    description: "Спам",
    createdAt: "2026-08-27T00:00:00.000Z",
  };

  it("should parse a user with bounded recent activity", () => {
    // Act
    const result = adminUserDetailDtoSchema.safeParse({
      ...user,
      recentTrips: [trip],
      recentBookings: [booking],
      recentReports: [report],
      recentFeedback: [feedback],
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject recent activity arrays above the cap", () => {
    // Act
    const result = adminUserDetailDtoSchema.safeParse({
      ...user,
      recentTrips: Array.from({ length: 21 }, () => trip),
      recentBookings: [],
      recentReports: [],
      recentFeedback: [],
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject unknown fields (strict)", () => {
    // Act
    const result = adminUserDetailDtoSchema.safeParse({
      ...user,
      recentTrips: [],
      recentBookings: [],
      recentReports: [],
      recentFeedback: [],
      recentReviews: [],
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminTelegramStopResponseDtoSchema", () => {
  it("should parse the telegram-stop response", () => {
    // Act
    const result = adminTelegramStopResponseDtoSchema.safeParse({
      success: true,
      hadConsent: true,
      cancelledDeliveries: 3,
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject a negative cancelledDeliveries count", () => {
    // Act
    const result = adminTelegramStopResponseDtoSchema.safeParse({
      success: true,
      hadConsent: false,
      cancelledDeliveries: -1,
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminTelegramMetricsDtoSchema", () => {
  it("should parse metrics with a skipped reason breakdown", () => {
    // Act
    const result = adminTelegramMetricsDtoSchema.safeParse({
      channelEnabled: true,
      total: 10,
      pending: 2,
      processing: 1,
      delivered: 6,
      failed: 0,
      skipped: { no_token: 1 },
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject non-numeric skip counters", () => {
    // Act
    const result = adminTelegramMetricsDtoSchema.safeParse({
      channelEnabled: false,
      total: 1,
      pending: 0,
      processing: 0,
      delivered: 0,
      failed: 0,
      skipped: { no_token: "1" },
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminDashboardDtoSchema — actionable counts", () => {
  const dashboard = {
    totalUsers: 22,
    totalTrips: 31,
    activeTrips: 19,
    totalBookings: 40,
    totalReviews: 19,
    newUsersLast7Days: 22,
    pendingReviews: 4,
    openReports: 2,
    unansweredFeedback: 1,
    telegramPending: 3,
    telegramFailed: 0,
  };

  it("should parse all actionable counts", () => {
    // Act
    const result = adminDashboardDtoSchema.safeParse(dashboard);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should require actionable counts", () => {
    const { telegramFailed: _omitted, ...rest } = dashboard;

    // Act
    const result = adminDashboardDtoSchema.safeParse(rest);

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminUsersQuerySchema — exact filters", () => {
  it("should parse exact id, telegramUserId and phone filters", () => {
    // Act
    const result = adminUsersQuerySchema.safeParse({
      id: "u-1",
      telegramUserId: "123456789",
      phone: "+79990000000",
    });

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("should reject non-numeric telegramUserId", () => {
    // Act
    const result = adminUsersQuerySchema.safeParse({ telegramUserId: "u-1" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject unknown query params (strict)", () => {
    // Act
    const result = adminUsersQuerySchema.safeParse({ role: "admin" });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("bannedErrorSchema", () => {
  it("should parse valid 403 ban error with reason", () => {
    // Act
    const result = bannedErrorSchema.safeParse({
      code: "FORBIDDEN",
      message: "Account is banned",
      banReason: "Спам в чатах",
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should parse valid 403 ban error with null banReason (legacy ban)", () => {
    // Act
    const result = bannedErrorSchema.safeParse({
      code: "FORBIDDEN",
      message: "Account is banned",
      banReason: null,
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject error with non-FORBIDDEN code (literal type)", () => {
    // Act
    const result = bannedErrorSchema.safeParse({
      code: "UNAUTHORIZED",
      message: "Account is banned",
      banReason: null,
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject error with missing banReason", () => {
    // Act
    const result = bannedErrorSchema.safeParse({
      code: "FORBIDDEN",
      message: "Account is banned",
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject error with extra fields (strict)", () => {
    // Act
    const result = bannedErrorSchema.safeParse({
      code: "FORBIDDEN",
      message: "Account is banned",
      banReason: null,
      extra: true,
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminTripDetailDtoSchema", () => {
  const trip = {
    id: "t-1",
    fromCity: "Москва",
    toCity: "Тула",
    fromAddress: "Тверская, 1",
    toAddress: "Ленина, 1",
    price: 500,
    seatsTotal: 3,
    seatsAvailable: 2,
    status: "active",
    departureAt: "2026-09-01T10:00:00.000Z",
    createdAt: "2026-08-27T00:00:00.000Z",
    driverName: "Иван Петров",
    driverId: "u-1",
  };

  const booking = {
    id: "b-1",
    seat: 1,
    status: "confirmed",
    passengerId: "u-2",
    passengerName: "Мария Иванова",
    createdAt: "2026-08-27T00:00:00.000Z",
  };

  it("should parse a trip with bounded booking summaries", () => {
    // Act
    const result = adminTripDetailDtoSchema.safeParse({
      ...trip,
      bookings: [booking],
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject a bookings array above the cap", () => {
    // Act
    const result = adminTripDetailDtoSchema.safeParse({
      ...trip,
      bookings: Array.from({ length: 101 }, (_, index) => ({
        ...booking,
        id: `b-${index}`,
      })),
    });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject unknown fields (strict)", () => {
    // Act
    const result = adminTripDetailDtoSchema.safeParse({
      ...trip,
      bookings: [],
      driverPhone: "+79990000000",
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminBookingDetailDtoSchema", () => {
  const booking = {
    id: "b-1",
    seat: 1,
    status: "confirmed",
    createdAt: "2026-08-27T00:00:00.000Z",
    tripId: "t-1",
    tripRoute: "Москва → Тула",
    passengerId: "u-2",
    passengerName: "Мария Иванова",
    fromCity: "Москва",
    toCity: "Тула",
    departureAt: "2026-09-01T10:00:00.000Z",
    tripStatus: "active",
    driverId: "u-1",
    driverName: "Иван Петров",
    passengerAvatar: "https://i.pravatar.cc/200?img=12",
    passengerRating: 4.5,
    passengerPhone: "+79990000000",
  };

  it("should parse booking, trip and passenger context", () => {
    // Act
    const result = adminBookingDetailDtoSchema.safeParse(booking);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should allow a passenger without a phone", () => {
    // Act
    const result = adminBookingDetailDtoSchema.safeParse({
      ...booking,
      passengerPhone: null,
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject unknown fields (strict)", () => {
    // Act
    const result = adminBookingDetailDtoSchema.safeParse({
      ...booking,
      driverPhone: "+79990000000",
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("adminReviewDetailDtoSchema", () => {
  const review = {
    id: "r-1",
    rating: 5,
    text: "Отличная поездка",
    targetRole: "driver",
    status: "pending" as const,
    tripRoute: "Москва → Тула",
    createdAt: "2026-08-27T00:00:00.000Z",
    authorId: "u-2",
    authorName: "Мария Иванова",
    targetUserId: "u-1",
    targetUserName: "Иван Петров",
    author: {
      id: "u-2",
      name: "Мария Иванова",
      avatar: "https://i.pravatar.cc/200?img=12",
      rating: 4.8,
      bannedAt: null,
    },
    target: {
      id: "u-1",
      name: "Иван Петров",
      avatar: "https://i.pravatar.cc/200?img=13",
      rating: 4.6,
      bannedAt: null,
    },
  };

  it("should parse full text plus author and target summaries", () => {
    // Act
    const result = adminReviewDetailDtoSchema.safeParse(review);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should require both author and target summaries", () => {
    const { target: _omitted, ...rest } = review;

    // Act
    const result = adminReviewDetailDtoSchema.safeParse(rest);

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject unknown fields (strict)", () => {
    // Act
    const result = adminReviewDetailDtoSchema.safeParse({
      ...review,
      targetPhone: "+79990000000",
    });

    // Assert
    expect(result.success).toBe(false);
  });
});

describe("admin list query schemas — operational filters", () => {
  it("should parse trip route, driver and text filters", () => {
    // Act
    const result = adminTripsQuerySchema.safeParse({
      q: "  Москва  ",
      driverId: "u-1",
      fromCity: "Москва",
      toCity: "Тула",
    });

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("Москва");
      expect(result.data.driverId).toBe("u-1");
    }
  });

  it("should not inject defaults for absent trip filters", () => {
    // Act
    const result = adminTripsQuerySchema.safeParse({});

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.driverId).toBeUndefined();
      expect(result.data.fromCity).toBeUndefined();
      expect(result.data.toCity).toBeUndefined();
    }
  });

  it("should parse booking passenger and trip filters", () => {
    // Act
    const result = adminBookingsQuerySchema.safeParse({
      q: "Иванова",
      passengerId: "u-2",
      tripId: "t-1",
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should parse review author and target filters", () => {
    // Act
    const result = adminReviewsQuerySchema.safeParse({
      q: "поездка",
      authorId: "u-2",
      targetUserId: "u-1",
    });

    // Assert
    expect(result.success).toBe(true);
  });

  it("should parse feedback answered as a string literal", () => {
    // Act
    const result = adminFeedbackQuerySchema.safeParse({
      q: "поддержка",
      answered: "false",
    });

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.answered).toBe("false");
    }
  });

  it("should reject non-literal feedback answered values", () => {
    // Act
    const result = adminFeedbackQuerySchema.safeParse({ answered: "1" });

    // Assert
    expect(result.success).toBe(false);
  });

  it("should reject unknown query params (strict)", () => {
    // Act
    const result = adminBookingsQuerySchema.safeParse({ unknownFilter: "x" });

    // Assert
    expect(result.success).toBe(false);
  });
});
