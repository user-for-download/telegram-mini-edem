import { z } from "zod";

// Максимальная длина текста отзыва: ограничение выбрано так, чтобы отзыв
// помещался в multiline-карточку (3 строки на телефоне) без Popover.
export const REVIEW_TEXT_MAX_LENGTH = 150;

// ─── CreateReviewDto ────────────────────────────────────────────────────────
export const createReviewDtoSchema = z.object({
  tripId: z.string(),
  targetUserId: z.string(),
  rating: z.number().int().min(1).max(5),
  // .trim() — проверка (check) в zod 4: выполняется до min/max, поэтому
  // строки только из пробелов отклоняются, а лимиты применяются к обрезанному
  // значению (единообразно с createFeedbackDtoSchema).
  text: z.string().trim().min(1).max(REVIEW_TEXT_MAX_LENGTH),
}).strict();

export type CreateReviewDto = z.infer<typeof createReviewDtoSchema>;
