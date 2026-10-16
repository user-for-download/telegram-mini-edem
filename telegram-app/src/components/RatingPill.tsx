import { Star } from "lucide-react";
import { Chip as TguiChip } from "@telegram-apps/telegram-ui";
import { hasRating } from "@/helpers/rating";
import styles from "./RatingPill.module.css";

interface RatingPillProps {
  /** Значение рейтинга 0…5. */
  value: number | null;
  /**
   * Сколько отзывов за оценкой. Нужен, чтобы отличить ОТСУТСТВИЕ рейтинга
   * от его значения: контракт отдаёт `rating` обязательным (`min(0).max(5)`),
   * поэтому ветка `value == null` из API недостижима, а «рейтинга нет»
   * приходит как ЧИСЛО:
   *   - 5.0 — новый пользователь (`auth/index.ts` создаёт rating: 5),
   *     у которого ноль отзывов: без проверки он светился бы идеальной
   *     оценкой при пустом профиле;
   *   - 0.0 — `recomputeUserRating` обнуляет, когда опубликованных отзывов
   *     не осталось (например, админ удалил последний).
   * Оба значения при `reviewsCount === 0` показываем прочерком.
   */
  reviewsCount?: number | null;
  /** Размер пилюли. */
  size?: "m" | "s";
}

/**
 * Пилюля рейтинга «★ 4.9» на нативном `Chip` кита (mode mono, корневой
 * элемент — дефолтный `div` кита): звезда lucide в слоте before,
 * десятичный разделитель — точка, нет оценки — прочерк. Фон и текст — из
 * переменных темы UI-кита.
 *
 * a11y (F27): `aria-label` висит на корне пилюли, поэтому корень обязан
 * быть узлом, который имя вообще экспонирует, — `role="img"`. На голом
 * `Component="span"` вычисленная роль generic, а generic `aria-label` НЕ
 * экспонирует: подпись «Рейтинг 4.8 из 5» молча терялась, и, так как
 * звезда внутри уже `aria-hidden`, пилюля деградировала до голого числа
 * «4.8» — без единицы измерения и без контекста. Роль img делает потомков
 * презентационными: видимое «4.8» в озвучку не попадает, но оно дословно
 * входит в имя («Рейтинг 4.8 из 5»), так что WCAG 2.5.3 «Label in Name»
 * соблюдён. Тот же приём — в components/ReviewCard/ReviewCard.tsx (F2) и
 * components/Trip/AvatarStack.tsx.
 *
 * Корневой элемент НЕ переопределяем: китовый `Chip` кладёт слот `before`
 * в жёсткий `<div>`, а children — через `Subheadline` без явного `Component`,
 * то есть в `<h6>` (Subheadline.js: `Component || 'h6'`). Оба — flow
 * content, а `<span>` допускает только phrasing content: на спане пилюля
 * отдавала невалидную разметку (`<span><div>…</div><h6>4.8</h6></span>`).
 * Клиентский рендер (createRoot) такое дерево строит как есть, а разбор той
 * же строки HTML-парсером — уже нет, поэтому разметка опасна при SSR и при
 * любом innerHTML. Взят дефолт кита (`div`): разметка валидна, а на вид
 * ничего не меняется — и китовый класс корня (`display:inline-flex`), и
 * `.pill` уже задают inline-уровень, то есть `div` здесь схлопывается так
 * же, как спан.
 */
export function RatingPill({
  value,
  reviewsCount,
  size = "m",
}: RatingPillProps) {
  const clamped = hasRating(value, reviewsCount)
    ? Math.min(5, Math.max(0, value as number))
    : null;
  const label =
    clamped == null
      ? "Рейтинг пока отсутствует"
      : `Рейтинг ${clamped.toFixed(1)} из 5`;

  return (
    <TguiChip
      mode="mono"
      before={
        <span className={styles.star} aria-hidden="true">
          <Star
            size={size === "s" ? 12 : 14}
            fill="currentColor"
            strokeWidth={0}
          />
        </span>
      }
      className={`${styles.pill} ${size === "s" ? styles.small : ""}`}
      // Роль ставим рядом с подписью, а не на потомке: имя обязано
      // вычисляться на узле, который его экспонирует (см. докблок).
      role="img"
      aria-label={label}
    >
      {clamped == null ? "—" : clamped.toFixed(1)}
    </TguiChip>
  );
}
