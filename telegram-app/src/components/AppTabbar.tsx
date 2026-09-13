import { FixedLayout } from "@telegram-apps/telegram-ui";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Car, Home, Search, User } from "lucide-react";

export type AppTabId = "home" | "trips" | "search" | "profile";

const TABS = [
  { key: "home", text: "Главная", to: "/", Icon: Home },
  { key: "trips", text: "Поездки", to: "/bookings", Icon: Car },
  { key: "search", text: "Поиск", to: "/trips", Icon: Search },
  { key: "profile", text: "Профиль", to: "/profile", Icon: User },
] as const;

/**
 * Нижний бар — кастомный floating (язык образца): прозрачная подложка
 * с блюром, круглые приподнятые кнопки. Route-driven: активный таб
 * определяет роутер, компонент только рендерит и отдаёт выбор наружу.
 */
export function AppTabbar({
  activeTab,
  onSelect,
}: {
  activeTab: AppTabId;
  onSelect: (to: string) => void;
}) {
  return (
    <FixedLayout vertical="bottom" className="!z-50 w-full pointer-events-none">
      <div className="mx-auto w-full max-w-md px-4 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pointer-events-auto">
        <div
          role="tablist"
          aria-label="Основные разделы"
          className="flex items-center justify-around gap-1 rounded-[28px] border border-[var(--tgui--outline)]/60 bg-[var(--tgui--bg_color)]/75 px-2 py-2 shadow-lg shadow-black/10 backdrop-blur-md dark:shadow-black/40"
        >
          {TABS.map(({ key, text, to, Icon }) => {
            const selected = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-current={selected ? "page" : undefined}
                onClick={() => {
                  if (activeTab === key) return;
                  hapticFeedback.selectionChanged.ifAvailable();
                  onSelect(to);
                }}
                className={[
                  "flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200",
                  selected
                    ? "-translate-y-1 bg-[var(--tgui--button_color)] text-[var(--tgui--button_text_color)] shadow-md shadow-black/20"
                    : "bg-transparent text-[var(--tgui--hint_color)] hover:text-[var(--tgui--text_color)] active:scale-95",
                ].join(" ")}
              >
                <Icon size={22} strokeWidth={selected ? 2.5 : 1.8} />
                <span className="text-[9px] font-semibold leading-none">
                  {text}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </FixedLayout>
  );
}
