import { Caption, Title } from "@telegram-apps/telegram-ui";
import { CarFront } from "lucide-react";
import { setThemeOverride, useAppSettings } from "@/utils/appSettings";
import {
  PLATFORM_OPTIONS,
  choiceLabel,
  nextPlatformChoice,
  setDevPlatform,
  useDevPlatform,
} from "@/utils/devPlatform";

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
 */
export function AppHeader() {
  const devPlatform = useDevPlatform();
  const { themeOverride } = useAppSettings();

  return (
    <header className="sticky top-0 z-2 w-full backdrop-blur-md transition-colors border-b border-(--tgui--outline) bg-(--tgui--bg_color)/95 pt-[max(env(safe-area-inset-top,0px),var(--tg-safe-area-inset-top,0px))]">
      <div className="relative flex items-center justify-center px-4 py-2.5">
        <div className="flex items-center text-center">
          <div className="text-center">
            {/* Заголовок + бейдж — по базовой линии (items-baseline):
                у «Едем» есть спуск «д» под базой, у капс-пилюли — нет;
                items-center ставит пилюлю визуально выше строки. */}
            <div className="flex items-baseline justify-center gap-1.5">
              <Title level="2" weight="2">
                Едем
              </Title>
              <Caption
                weight="2"
                caps
                Component="span"
                className="text-(--tgui--link_color)"
              >
                Попутчики
              </Caption>
            </div>
            <Caption Component="div" className="mt-0.5">
              Вологодская область · между городами и сёлами
            </Caption>
          </div>
        </div>
        {SHOW_DEV_TOGGLES && (
          <div className="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1">
            <button
              type="button"
              aria-label="Переключить платформу UI-кита (Авто → iOS → Android)"
              title="Платформа UI-кита"
              onClick={() => setDevPlatform(nextPlatformChoice(devPlatform))}
              className="rounded-full px-2 py-1 text-xs font-semibold text-(--tgui--link_color)"
            >
              {choiceLabel(PLATFORM_OPTIONS, devPlatform)}
            </button>
            <button
              type="button"
              aria-label="Переключить тему (Авто → Светлая → Тёмная)"
              title="Тема"
              onClick={() => setThemeOverride(nextTheme(themeOverride))}
              className="rounded-full px-2 py-1 text-xs font-semibold text-(--tgui--link_color)"
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
