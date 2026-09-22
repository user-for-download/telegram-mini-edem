import styles from "./AppHeader.module.css";

/**
 * Заголовок раздела в верхней зоне фуллскрина: пустое место между
 * плавающими контролами Telegram («Закрыть»/«Опции») и контентом уже
 * занято под safe-area (padding-top колонки = --tg-safe-area-top,
 * см. AppShell.module.css) — заполняем его именем вкладки/страницы.
 *
 * position:absolute (shell position:relative): контент уже отодвинут
 * паддингом, absolute не влияет на скролл и route-fade. Строка прижата
 * к низу зоны. В нормальном (не-фуллскрин) режиме --tg-safe-area-top = 0,
 * зона схлопывается — header скрывается через CSS (у клиента своя шапка).
 */
export function AppHeader({ title }: { title?: string }) {
  if (!title) return null;
  return (
    <header className={styles.header} aria-hidden="true">
      <h1 className={styles.title}>{title}</h1>
    </header>
  );
}
