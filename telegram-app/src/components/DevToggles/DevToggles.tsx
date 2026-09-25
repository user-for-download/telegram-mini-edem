import { setThemeOverride, useAppSettings } from "@/utils/appSettings";
import {
  PLATFORM_OPTIONS,
  choiceLabel,
  nextPlatformChoice,
  setDevPlatform,
  useDevPlatform,
} from "@/utils/devPlatform";
import styles from "./DevToggles.module.css";

const THEME_CYCLE: ReadonlyArray<{
  value: "dark" | "light" | null;
  label: string;
}> = [
  { value: null, label: "Авто" },
  { value: "light", label: "Светлая" },
  { value: "dark", label: "Тёмная" },
];

function nextTheme(current: "dark" | "light" | null): "dark" | "light" | null {
  const index = THEME_CYCLE.findIndex((option) => option.value === current);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length]?.value ?? null;
}

/**
 * Dev-панель быстрых переключателей платформы UI-кита и темы — преемник
 * тумблеров удалённого AppHeader: плавающая пилюля над контентом, видна
 * с любого экрана (браузерный стенд), раскладку не сдвигает.
 * Гейт import.meta.env.DEV возвращает null не в dev — в прод-сборке код
 * выпиливается tree-shaking'ом: прод в Telegram следует за клиентом.
 *
 * U3-решение: raw <button> оставлен осознанно — пилюля dev-only
 * (в прод-бандл не попадает), метрики bespoke (5px 12px, кегль 12px)
 * не ложатся ни на один размер кита, а зависимость dev-инструмента
 * от API кита не нужна. Стили — в DevToggles.module.css, style-хаков нет.
 */
export function DevToggles() {
  if (!import.meta.env.DEV) return null;
  return <DevTogglesBody />;
}

function DevTogglesBody() {
  const devPlatform = useDevPlatform();
  const { themeOverride } = useAppSettings();

  return (
    <div className={styles.panel}>
      <button
        type="button"
        aria-label="Переключить платформу UI-кита (Авто → iOS → Android)"
        title="Платформа UI-кита"
        onClick={() => setDevPlatform(nextPlatformChoice(devPlatform))}
        className={styles.devButton}
      >
        {choiceLabel(PLATFORM_OPTIONS, devPlatform)}
      </button>
      <button
        type="button"
        aria-label="Переключить тему (Авто → Светлая → Тёмная)"
        title="Тема"
        onClick={() => setThemeOverride(nextTheme(themeOverride))}
        className={styles.devButton}
      >
        {THEME_CYCLE.find((option) => option.value === themeOverride)?.label ??
          "Авто"}
      </button>
    </div>
  );
}
