import { z } from "zod";
import {
  createFeedbackResponseSchema,
  userFeedbackDtoSchema,
  type CreateFeedbackDto,
  type CreateFeedbackResponse,
  type FeedbackTelegramAppealDto,
  type UserFeedbackDto,
} from "@edem/contracts";
import { apiClient } from "./client";

const userFeedbackListSchema = z.array(userFeedbackDtoSchema);

/**
 * Обращения в поддержку Telegram-приложения (паритет feedback.api):
 * авторизованные POST /feedback и GET /feedback работают с TG JWT через
 * requireUser; апелляция забаненного — публичный POST /feedback/appeal
 * с raw initData (TG-ветка backend, подпись verifyTelegramInitData).
 */
export const supportApi = {
  /**
   * Отправка обращения в поддержку (SupportPage → форма).
   */
  create: (data: CreateFeedbackDto): Promise<CreateFeedbackResponse> => {
    return apiClient.request<CreateFeedbackResponse>(
      "/feedback",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      createFeedbackResponseSchema,
    );
  },

  /**
   * Апелляция забаненного пользователя (экран бана → Обратная связь).
   * Публичный эндпоинт: у забаненного нет токена, личность подтверждается
   * подписью Telegram initData на бэкенде (TG-ветка /feedback/appeal).
   * initData — сырая строка из стора (та же, что в /auth/telegram);
   * display-поля внутри неё backend игнорирует. apiClient добавляет
   * Authorization только при наличии токена — здесь его нет.
   */
  appeal: (data: FeedbackTelegramAppealDto): Promise<CreateFeedbackResponse> => {
    return apiClient.request<CreateFeedbackResponse>(
      "/feedback/appeal",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
      createFeedbackResponseSchema,
    );
  },

  /**
   * Список СВОИХ обращений с ответами админа
   * (SupportPage → «Мои обращения»). Авторизация обязательна.
   */
  listMine: (signal?: AbortSignal): Promise<UserFeedbackDto[]> => {
    return apiClient.request<UserFeedbackDto[]>(
      "/feedback",
      { signal },
      userFeedbackListSchema,
    );
  },
};
