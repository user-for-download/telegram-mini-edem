import { Caption, Title } from "@telegram-apps/telegram-ui";
import { CarFront } from "lucide-react";

/**
 * Sticky-шапка приложения (язык AppHeader примера): бренд + бейдж,
 * строго под нативными контролами Telegram (safe-area-top), без
 * ручных переключателей — тема следует за клиентом (AppConfig).
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-[2] w-full backdrop-blur-md transition-colors border-b border-(--tgui--outline) bg-(--tgui--bg_color)/95 pt-[max(env(safe-area-inset-top,0px),var(--tg-safe-area-inset-top,0px))]">
      <div className="flex items-center justify-center px-4 py-2.5">
        <div className="flex items-center gap-2.5 text-center">
          <div className="w-8 h-8 rounded-xl bg-(--app-info-bg) text-(--app-info) flex items-center justify-center font-bold">
            <CarFront size={18} />
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5">
              <Title
                level="2"
                weight="2"
                className="!text-[18px] tracking-tight leading-none font-bold"
              >
                Едем
              </Title>
              <span className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded bg-(--tgui--secondary_fill) text-(--tgui--link_color) leading-none">
                Попутчики
              </span>
            </div>
            <Caption className="!text-(--tgui--hint_color) !text-[11px] leading-tight block mt-0.5">
              Вологодская область · между городами и сёлами
            </Caption>
          </div>
        </div>
      </div>
    </header>
  );
}
