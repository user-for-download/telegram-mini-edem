import styles from "./NavHeader.module.css";

/**
 * Sticky in-app навбар по спекам официального клиента
 * (Display/Source/NavigationBar.swift): полоса 44px под safe-area зоной,
 * фон + блюр, hairline-сепаратор снизу, центрированный заголовок 17/600
 * primary-цветом, одна строка с ellipsis.
 *
 * Назад — нативный BackButton клиента (Shell показывает его на
 * не-корневых маршрутах): in-app шеврона 13x22 нет, чтобы не было
 * двух беков. aria-hidden: авторитетные h1 живут на страницах,
 * видимая строка их дублирует.
 */
export function NavHeader({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <header className={styles.bar} aria-hidden="true">
      <span className={styles.title}>{title}</span>
    </header>
  );
}
