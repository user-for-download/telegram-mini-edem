import { Navigate, useSearchParams } from "react-router-dom";
import { TripActivePage } from "../TripActive/TripActivePage";

/**
 * «Поездки» — только активные (табов больше нет). История живёт
 * отдельной страницей /profile/history (пункт меню профиля).
 * ?segment=history — совместимость со старыми ссылками и закэшированным
 * клиентом: ведём на новую страницу вместо молчаливого игнора.
 * Корень Page владеет сам TripActivePage — здесь обёртки нет
 * (двойной List дал бы двойной ритм/паддинги).
 */
export function TripPage() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("segment") === "history") {
    return <Navigate to="/profile/history" replace />;
  }
  return <TripActivePage />;
}
