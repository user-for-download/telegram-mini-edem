import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/api/client";
import { supportApi } from "@/api/support";
import { useAuthStore } from "@/store/useAuthStore";
import { getRawInitData } from "@/utils/telegram-adapter";
import type { CreateFeedbackDto, CreateFeedbackResponse } from "@edem/contracts";

export const SUPPORT_KEYS = {
  all: ["feedback"] as const,
  mine: () => [...SUPPORT_KEYS.all, "mine"] as const,
};

/**
 * Список СВОИХ обращений с ответами админа (порт useMyFeedbacksQuery).
 * Запрос активен только для авторизованных: апелляция
 * забаненного — отдельный flow без токена через submitSupportFeedback
 * (публичный POST /feedback/appeal с initData из стора).
 */
export function useMyFeedbacksQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: SUPPORT_KEYS.mine(),
    queryFn: ({ signal }) => supportApi.listMine(signal),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useCreateFeedbackMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateFeedbackDto) => supportApi.create(data),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: SUPPORT_KEYS.mine() }),
  });
}

/**
 * Отправка обращения с маршрутизацией submitFeedback:
 * с токеном — обычный POST /feedback, без токена (забаненный) — публичный
 * POST /feedback/appeal, где личность подтверждается raw initData из стора
 * авторизации (та же строка, что в /auth/telegram). Экспортируется для
 * прямого тестирования маршрутизации (без рендера).
 *
 * Фолбэк на getRawInitData() — страховка границы отправки, а не костыль:
 * стор заполняет initData при бане (markBanned) и при bootstrap, но
 * ветка «403 на /feedback, статус сессии ещё authenticated» (SupportPage)
 * в стор не заходит вовсе. Без фолбэка апелляция оттуда не уходила бы.
 * Сырая строка, без пересортировки — HMAC должен сойтись.
 */
export async function submitSupportFeedback(
  data: CreateFeedbackDto,
): Promise<CreateFeedbackResponse> {
  if (apiClient.getToken()) {
    return supportApi.create(data);
  }

  const initData = useAuthStore.getState().initData ?? getRawInitData();
  if (!initData) {
    throw new Error("Не удалось отправить обращение");
  }

  return supportApi.appeal({ initData, ...data });
}

/**
 * Апелляция забаненного (экран бана, 403-ветка SupportPage): маршрутизация
 * через submitSupportFeedback — без токена уходит в appeal с initData.
 */
export function useAppealFeedbackMutation() {
  return useMutation({
    mutationFn: submitSupportFeedback,
  });
}
