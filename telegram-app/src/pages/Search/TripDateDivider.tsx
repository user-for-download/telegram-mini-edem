import styles from "./TripDateDivider.module.css";

/**
 * Пилюля даты в ленте поиска: статичный центрированный заголовок группы
 * («Сегодня» / «Завтра» / «12 сентября»). h2 — у страницы есть свой h1.
 * Не Chip: заголовок не интерактивен. Без счётчика: группа, разрезанная
 * страницами инфинит-ленты, посчиталась бы частично.
 */
export function TripDateDivider({ label }: { label: string }) {
  return (
    <h2 className={styles.pill}>
      <span className={styles.text}>{label}</span>
    </h2>
  );
}
