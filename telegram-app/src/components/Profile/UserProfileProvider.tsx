import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { UserProfileSheet } from "./UserProfileSheet";

/**
 * Что открываем: id обязателен (по нему идёт запрос), initial — копия
 * пользователя, которая уже лежит в руках вызывающего (водитель из
 * поездки, пассажир из заявки, автор отзыва). Её рисуем сразу, не дожидаясь
 * сети, а догрузка идёт фоном через useUserQuery.
 */
export interface UserProfileTarget {
  id: string;
  /**
   * Заголовок шторки. Роль человека в контексте, откуда открыли:
   * «Водитель» / «Пассажир». Имя заголовком НЕ ставим — оно уже есть
   * в hero ниже, получался дубль «ФИО → ФИО». Без title — имя (или
   * «Профиль», если открыто только по id).
   */
  title?: string;
  initial?: {
    name: string;
    avatar?: string | null;
    rating: number;
    reviewsCount: number;
    tripsCount: number;
    isVerified?: boolean;
    about?: string | null;
    car?: { model: string; color: string } | null;
  };
}

interface UserProfileContextValue {
  open: (target: UserProfileTarget) => void;
}

const UserProfileContext = createContext<UserProfileContextValue | null>(null);

/**
 * Провайдер шторки профиля другого человека: держит одного открытого
 * пользователя и рендерит ЕДИНСТВУЮ шторку на приложение.
 *
 * Смонтирован в Shell выше Outlet — состояние переживает смену маршрута
 * (открыл из «Поиска», ушёл в детали — шторка осталась), и любой экран
 * может открыть её без прокидывания колбэков через props.
 *
 * ВНЕ провайдера useOpenUserProfile отдаёт no-op, а не бросает: целый
 * пласт компонентов (карточка поездки, отзыв) рендерится в SSR-тестах
 * через renderToString без обёртки. Бросок здесь уронил бы их все.
 */
export function UserProfileProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<UserProfileTarget | null>(null);

  const open = useCallback((next: UserProfileTarget) => {
    setTarget(next);
  }, []);
  const close = useCallback(() => setTarget(null), []);

  const value = useMemo<UserProfileContextValue>(() => ({ open }), [open]);

  return (
    <UserProfileContext.Provider value={value}>
      {children}
      <UserProfileSheet target={target} onClose={close} />
    </UserProfileContext.Provider>
  );
}

let warnedOutsideProvider = false;

/**
 * Открыть шторку профиля. Вне провайдера — no-op (см. выше), чтобы
 * презентационные компоненты оставались рендерящимися без обёртки.
 *
 * No-op — молчаливый по необходимости, но не бесшумный в dev: забытый
 * Provider на новом экране давал бы мёртвые клики без единого сигнала
 * (M5 аудита). Предупреждение — один раз за сессию и только в dev: в проде
 * трешак в консоль пользователю не нужен.
 */
export function useOpenUserProfile(): (target: UserProfileTarget) => void {
  const context = useContext(UserProfileContext);
  // Предупреждение — в эффекте, а не в рендере: присвоение module-флага
  // в рендере нарушает purity-правило (side effect), эффект — нет.
  // В SSR (renderToString) эффекты не выполняются — там тихо.
  useEffect(() => {
    if (!context && import.meta.env.DEV && !warnedOutsideProvider) {
      warnedOutsideProvider = true;
      console.warn(
        "[UserProfile] useOpenUserProfile вне UserProfileProvider: " +
          "тап по человеку ничего не откроет. Оберните экран в провайдер.",
      );
    }
  }, [context]);
  return context?.open ?? noop;
}

function noop(): void {
  /* вне UserProfileProvider */
}
