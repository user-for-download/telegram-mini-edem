import { z } from "zod";
import {
  bookingSchema,
  paginatedBookingsResponseSchema,
  passengerBookingSchema,
  type Booking,
  type CreateBookingDto,
  type PaginatedBookingsResponse,
  type PassengerBooking,
  type UpdateBookingStatusDto,
} from "@edem/contracts";
import { apiClient } from "./client";

const passengerBookingsSchema = z.array(passengerBookingSchema);
const bookingsListSchema = z.array(bookingSchema);
const successSchema = z.object({ success: z.boolean() }).strict();

export const bookingsApi = {
  getUserBookings: (signal?: AbortSignal): Promise<PassengerBooking[]> =>
    apiClient.request("/bookings/my", { signal }, passengerBookingsSchema),

  /**
   * Pending-заявки на все активные поездки текущего водителя
   * (сводка для главной страницы).
   */
  getDriverRequests: (signal?: AbortSignal): Promise<Booking[]> =>
    apiClient.request("/bookings/driver", { signal }, bookingsListSchema),

  getHistory: (signal?: AbortSignal): Promise<PassengerBooking[]> =>
    apiClient.request("/bookings/history", { signal }, passengerBookingsSchema),

  getTripBookings: (
    tripId: string,
    cursor?: string,
    limit = 50,
    signal?: AbortSignal,
  ): Promise<PaginatedBookingsResponse> => {
    const query = new URLSearchParams({ limit: String(limit) });
    if (cursor) query.set("cursor", cursor);

    return apiClient.request(
      `/bookings/trip/${encodeURIComponent(tripId)}?${query.toString()}`,
      { signal },
      paginatedBookingsResponseSchema,
    );
  },

  createBooking: (data: CreateBookingDto): Promise<Booking> =>
    apiClient.request(
      "/bookings",
      { method: "POST", body: JSON.stringify(data) },
      bookingSchema,
    ),

  updateBookingStatus: (
    id: string,
    data: UpdateBookingStatusDto,
  ): Promise<Booking> =>
    apiClient.request(
      `/bookings/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify(data) },
      bookingSchema,
    ),

  cancelBooking: (id: string): Promise<{ success: boolean }> =>
    apiClient.request(
      `/bookings/${encodeURIComponent(id)}/cancel`,
      { method: "PATCH" },
      successSchema,
    ),
};
