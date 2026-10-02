// Вне Telegram (прод-сборка): init data и launch params отсутствуют, SDK
// бросает при retrieveLaunchParams — показываем объяснение.
//
// Чистый HTML, а не Placeholder/Button кита: этот экран рендерится ДО
// инициализации SDK, то есть снаружи AppRoot, и вне его контекста
// telegram-ui не отдаёт разметку — падает с «Wrap your app with <AppRoot>»
// и оставляет пустой экран (проверено в браузере: pageerror + ноль DOM).
// Та же причина, по которой фолбэк ErrorBoundary в AppConfig — plain HTML.
import styles from "./EnvUnsupported.module.css";

export function EnvUnsupported() {
  return (
    <div className={styles.root}>
      <h1 className={styles.title}>«Едем» — мини-приложение Telegram</h1>
      <p className={styles.text}>
        Откройте его через кнопку бота @edem_mini_bot в Telegram.
      </p>
      <a className={styles.link} href="https://t.me/edem_mini_bot">
        Открыть бота
      </a>
    </div>
  );
}
