import { FixedLayout } from "@telegram-apps/telegram-ui";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Car, Home, Search, User } from "lucide-react";

export type AppTabId = "home" | "trips" | "search" | "profile";

const TABS = [
  { key: "home", text: "Главная", to: "/", Icon: Home },
  { key: "trips", text: "Поездки", to: "/bookings", Icon: Car },
  { key: "profile", text: "Профиль", to: "/profile", Icon: User },
] as const;

const SEARCH_TAB = { key: "search", text: "Поиск", to: "/trips", Icon: Search } as const;

function go(activeTab: AppTabId, key: AppTabId, to: string, onSelect: (to: string) => void) {
  if (activeTab === key) return;
  hapticFeedback.selectionChanged.ifAvailable();
  onSelect(to);
}

const idleBtn =
  "bg-transparent text-[var(--tgui--hint_color)] hover:text-[var(--tgui--text_color)] active:scale-95";
// Активный таб: только цвет иконки, круглой заливки нет.
const activeBtn =
  "-translate-y-1 bg-transparent text-[var(--tgui--button_color)]";

/**
 * Нижний бар — кастомный floating (язык образца): прозрачная подложка
 * с блюром, круглые приподнятые кнопки, без теней. Три раздела в пилюле,
 * Поиск — отдельным кругом справа. Route-driven: активный таб определяет
 * роутер, компонент только рендерит и отдаёт выбор наружу.
 */
export function AppTabbar({
  activeTab,
  onSelect,
}: {
  activeTab: AppTabId;
  onSelect: (to: string) => void;
}) {
  const selectedSearch = activeTab === SEARCH_TAB.key;
  return (
    <FixedLayout vertical="bottom" className="!z-50 w-full pointer-events-none">
      <div className="mx-auto flex w-full max-w-md items-center gap-2 px-4 pb-[max(0.375rem,env(safe-area-inset-bottom,0px))] pointer-events-auto">
        <div
          role="tablist"
          aria-label="Основные разделы"
          className="flex flex-1 items-center justify-around gap-1 rounded-[28px] border border-[var(--tgui--outline)]/60 bg-[var(--tgui--bg_color)]/75 px-2 py-2 backdrop-blur-md"
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
                onClick={() => go(activeTab, key, to, onSelect)}
                className={[
                  "flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200",
                  selected ? activeBtn : idleBtn,
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
        <div className="rounded-full border border-[var(--tgui--outline)]/60 bg-[var(--tgui--bg_color)]/75 p-2 backdrop-blur-md">
          <button
            type="button"
            role="tab"
            aria-selected={selectedSearch}
            aria-current={selectedSearch ? "page" : undefined}
            aria-label={SEARCH_TAB.text}
            onClick={() => go(activeTab, SEARCH_TAB.key, SEARCH_TAB.to, onSelect)}
            className={[
              "flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200",
              selectedSearch ? activeBtn : idleBtn,
            ].join(" ")}
          >
            <SEARCH_TAB.Icon size={22} strokeWidth={selectedSearch ? 2.5 : 1.8} />
            <span className="text-[9px] font-semibold leading-none">
              {SEARCH_TAB.text}
            </span>
          </button>
        </div>
      </div>
    </FixedLayout>
  );
}
