import { Caption, Title } from "@telegram-apps/telegram-ui";
import { CarFront } from "lucide-react";

/**
 * Sticky-шапка приложения (язык AppHeader примера): бренд + бейдж,
 * строго под нативными контролами Telegram (safe-area-top), без
 * ручных переключателей — тема следует за клиентом (AppConfig).
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-2 w-full backdrop-blur-md transition-colors border-b border-(--tgui--outline) bg-(--tgui--bg_color)/95 pt-[max(env(safe-area-inset-top,0px),var(--tg-safe-area-inset-top,0px))]">
      <div className="flex items-center justify-center px-4 py-2.5">
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
      </div>
    </header>
  );
}
