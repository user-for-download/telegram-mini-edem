import { z } from "zod";
import {
  reportSchema,
  type CreateReportDto,
  type Report,
} from "@edem/contracts";
import { apiClient } from "./client";

const reportsSchema = z.array(reportSchema);

/**
 * Жалобы Telegram-приложения (паритет reports.api 1:1).
 *
 * Backend-маршруты (`GET /reports` — последние 50 своих, `POST /reports` —
 * mutationLimiter + reportLimiter 10/час, лимит «1 жалоба навсегда» → 409)
 * защищены requireUser и работают с TG JWT без изменений. Право жаловаться
 * (canReport: связь через брони, запрет self-report) и санитизация —
 * серверная сторона; клиент пробрасывает ApiError (409/403/429/400) в
 * маппер reportErrorMessage (reportValidation.ts).
 */
export const reportsApi = {
  create: (data: CreateReportDto): Promise<Report> =>
    apiClient.request(
      "/reports",
      { method: "POST", body: JSON.stringify(data) },
      reportSchema,
    ),

  listMine: (signal?: AbortSignal): Promise<Report[]> =>
    apiClient.request("/reports", { signal }, reportsSchema),
};
