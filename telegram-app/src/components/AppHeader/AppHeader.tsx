import { Caption, Title } from "@telegram-apps/telegram-ui";
import { setThemeOverride, useAppSettings } from "@/utils/appSettings";
import {
  PLATFORM_OPTIONS,
  choiceLabel,
  nextPlatformChoice,
  setDevPlatform,
  useDevPlatform,
} from "@/utils/devPlatform";
import styles from "./AppHeader.module.css";

/** Dev-стенд: быстрые переключатели платформы/темы видны только
 * в dev-сборке — прод в Telegram их не показывает. */
const SHOW_DEV_TOGGLES = import.meta.env.DEV;

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
 * Sticky-шапка приложения (язык AppHeader примера): бренд + бейдж,
 * строго под нативными контролами Telegram (safe-area-top), без
 * ручных переключателей — тема следует за клиентом (AppConfig).
 * Раскладка — AppHeader.module.css рядом (без Tailwind).
 */
export function AppHeader() {
  const devPlatform = useDevPlatform();
  const { themeOverride } = useAppSettings();

  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <div>
            {/* Заголовок + бейдж — по базовой линии (items-baseline):
                у «Едем» есть спуск «д» под базой, у капс-пилюли — нет;
                items-center ставит пилюлю визуально выше строки. */}
            <div className={styles.titleRow}>
              <Title level="2" weight="2">
                Едем
              </Title>
              <Caption
                weight="2"
                caps
                Component="span"
                className={styles.badge}
              >
                Попутчики
              </Caption>
            </div>
            <Caption Component="div" className={styles.subtitle}>
              Вологодская область · между городами и сёлами
            </Caption>
          </div>
        </div>
        {SHOW_DEV_TOGGLES && (
          <div className={styles.devToggles}>
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
              {THEME_CYCLE.find((option) => option.value === themeOverride)
                ?.label ?? "Авто"}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
