import { ReviewsBody, type ReviewsTab } from "@/components/Profile/ReviewsModal";

export type { ReviewsTab };

/**
 * Легаси-обёртка: page-роут /reviews заменён route-backed ReviewsRoute
 * (AppRouter) — тело живёт в ReviewsModal.ReviewsBody.
 * Собственной шапки нет: имя экрана — в нативной шапке клиента Telegram.
 * Оставлено для совместимости (тесты, прямые импорты).
 * Свой module.css не нужен: локальной раскладки нет, стили — в ReviewsBody.
 */
export function ReviewsPage({ initialTab = "mine" }: { initialTab?: ReviewsTab }) {
  return <ReviewsBody initialTab={initialTab} />;
}
