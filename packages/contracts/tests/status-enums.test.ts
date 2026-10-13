import { describe, expect, it } from "vitest";
import {
  BOOKING_STATUS,
  TRIP_STATUS,
} from "../src/schemas/status.const.js";
import { tripStatusSchema } from "../src/schemas/trip.schema.js";
import { bookingStatusSchema } from "../src/schemas/booking.schema.js";
import {
  RIDE_REQUEST_STATUS,
  rideRequestStatusSchema,
} from "../src/schemas/ride-request.schema.js";
import { REPORT_STATUSES } from "../src/schemas/report.schema.js";
import { updateReportStatusDtoSchema } from "../src/dto/report.dto.js";

/**
 * Пин «единого источника»: wire-схемы обязаны принимать РОВНО значения
 * своей константы. Раньше trip/booking/ride-request переписывали те же
 * строки литералами в схеме — правка константы расходилась бы со схемой
 * молча. Если литералы снова вернутся, эти тесты упадут.
 */
describe("status enums derived from single-source constants", () => {
  it("tripStatusSchema covers TRIP_STATUS and rejects unknown", () => {
    for (const value of Object.values(TRIP_STATUS)) {
      expect(tripStatusSchema.safeParse(value).success).toBe(true);
    }
    expect(tripStatusSchema.safeParse("archived").success).toBe(false);
  });

  it("bookingStatusSchema covers BOOKING_STATUS and rejects unknown", () => {
    for (const value of Object.values(BOOKING_STATUS)) {
      expect(bookingStatusSchema.safeParse(value).success).toBe(true);
    }
    expect(bookingStatusSchema.safeParse("expired").success).toBe(false);
  });

  it("rideRequestStatusSchema covers RIDE_REQUEST_STATUS and rejects unknown", () => {
    for (const value of Object.values(RIDE_REQUEST_STATUS)) {
      expect(rideRequestStatusSchema.safeParse(value).success).toBe(true);
    }
    expect(rideRequestStatusSchema.safeParse("deleted").success).toBe(false);
  });

  it("updateReportStatusDtoSchema allows every status except the initial 'pending'", () => {
    for (const status of REPORT_STATUSES) {
      if (status === "pending") continue;
      expect(updateReportStatusDtoSchema.safeParse({ status }).success).toBe(true);
    }
    expect(updateReportStatusDtoSchema.safeParse({ status: "pending" }).success).toBe(false);
  });
});
