import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
 * Запрос активен только для авторизованных: апелляция забаненного —
 * отдельный flow через канал "appeal" submitSupportFeedback
 * (публичный POST /feedback/appeal с initData).
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
 * Канал отправки обращения — его называет ВЫЗЫВАЮЩИЙ, а не код выводит из
 * наличия токена.
 *
 * "session" — обычный POST /feedback (requireUser, docs/api/feedback.md:15).
 * "appeal" — публичный POST /feedback/appeal: личность подтверждается подписью
 * raw initData, токен не нужен и не выдаётся (docs/api/feedback.md:17-20).
 *
 * Канал обязателен и не имеет значения по умолчанию именно потому, что
 * прежний вывод «есть токен → session» был неверен: бан НЕ логаут, JWT
 * stateless, бан не приходит в открытый WS, а emitBanned живёт только в
 * performRefresh — на ветке «403 на GET /feedback» (SupportPage) токен в
 * apiClient ещё валиден, и апелляция уходила в requireUser → 403 в тупик
 * до истечения токена (~15 мин). Обязательный параметр делает решение
 * явным по построению: забыть канал нельзя — это ошибка компиляции.
 */
export type SupportFeedbackChannel = "session" | "appeal";

/**
 * Отправка обращения с явным выбором канала.
 *
 * Канал "appeal": initData берётся из стора авторизации (экран бана в AuthGate
 * — там applyBanned её уже заполнил), а в ветке «403 на /feedback» (SupportPage)
 * бан в стор ещё не доехал, поэтому строка подбирается из SDK напрямую —
 * без пересортировки, иначе HMAC на бэкенде не сойдётся. Бан не трогает
 * сессию и не пуржит launch params (MEMORY.md §18) — материал для апелляции
 * обязан пережить его.
 *
 * Экспортируется для прямого тестирования маршрутизации (без рендера).
 */
export async function submitSupportFeedback(
  data: CreateFeedbackDto,
  channel: SupportFeedbackChannel,
): Promise<CreateFeedbackResponse> {
  if (channel === "session") {
    return supportApi.create(data);
  }

  const initData = useAuthStore.getState().initData ?? getRawInitData();
  if (!initData) {
    throw new Error("Не удалось отправить обращение");
  }

  return supportApi.appeal({ initData, ...data });
}

/**
 * Апелляция забаненного (экран бана в AuthGate, ветка 403 на SupportPage).
 *
 * Канал задан здесь — оба экрана это бан по определению, и сессия у
 * забаненного может быть ещё жива (см. SupportFeedbackChannel). Проверять
 * токен здесь нельзя: именно его наличие и уводило апелляцию в 403.
 */
export function useAppealFeedbackMutation() {
  return useMutation({
    mutationFn: (data: CreateFeedbackDto) =>
      submitSupportFeedback(data, "appeal"),
  });
}
