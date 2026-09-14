import { Badge, FixedLayout } from "@telegram-apps/telegram-ui";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { Bell, Car, Home, Search, User } from "lucide-react";

export type AppTabId = "home" | "trips" | "notifications" | "search" | "profile";

const TABS = [
  { key: "home", text: "Главная", to: "/", Icon: Home },
  { key: "trips", text: "Поездки", to: "/bookings", Icon: Car },
  { key: "notifications", text: "Уведомления", to: "/notifications", Icon: Bell },
  { key: "profile", text: "Профиль", to: "/profile", Icon: User },
] as const;

const SEARCH_TAB = { key: "search", text: "Поиск", to: "/trips", Icon: Search } as const;

function go(activeTab: AppTabId, key: AppTabId, to: string, onSelect: (to: string) => void) {
  if (activeTab === key) return;
  hapticFeedback.selectionChanged.ifAvailable();
  onSelect(to);
}

const idleBtn =
  "bg-transparent text-[var(--tgui--text_color)] active:scale-95";
// Активный таб: только цвет иконки, круглой заливки нет.
const activeBtn =
  "-translate-y-1 bg-transparent text-[var(--tgui--button_color)]";

/**
 * Нижний бар — кастомный floating (язык образца): прозрачная подложка
 * с блюром, круглые приподнятые кнопки, без теней. Четыре раздела в пилюле,
 * Поиск — отдельным кругом справа. Route-driven: активный таб определяет
 * роутер, компонент только рендерит и отдаёт выбор наружу. Бейдж
 * непрочитанных уведомлений — пропом (счётчик считает роутер из кэша inbox).
 */
export function AppTabbar({
  activeTab,
  onSelect,
  unreadCount = 0,
}: {
  activeTab: AppTabId;
  onSelect: (to: string) => void;
  unreadCount?: number;
}) {
  const selectedSearch = activeTab === SEARCH_TAB.key;
  return (
    <FixedLayout vertical="bottom" className="!z-[2] w-full pointer-events-none">
      <div className="mx-auto flex w-full max-w-md items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom,0px),var(--tg-safe-area-inset-bottom,0px))] pointer-events-auto">
        <div
          role="tablist"
          aria-label="Основные разделы"
          className="flex flex-1 items-center justify-around gap-1 rounded-[28px] border border-gray-300 dark:border-white/20 bg-[var(--tgui--bg_color)]/75 px-2 py-1 backdrop-blur-md"
        >
          {TABS.map(({ key, text, to, Icon }) => {
            const selected = activeTab === key;
            const showBadge = key === "notifications" && unreadCount > 0;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-current={selected ? "page" : undefined}
                aria-label={showBadge ? `${text}, непрочитанных: ${unreadCount}` : text}
                onClick={() => go(activeTab, key, to, onSelect)}
                className={[
                  "relative flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200",
                  selected ? activeBtn : idleBtn,
                ].join(" ")}
              >
                <Icon size={22} strokeWidth={selected ? 2.5 : 1.8} />
                {showBadge && (
                  /* tgui Badge (tgui.xelene.me, Blocks): нативная пилюля
                     счётчика; кап 99+ — на нашей стороне, Badge рисует
                     children как есть. Число уже в aria-label кнопки. */
                  <Badge
                    type="number"
                    mode="critical"
                    aria-hidden="true"
                    className="absolute right-0.5 top-0.5 !m-0 pointer-events-none"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Badge>
                )}
                <span className="text-[9px] font-semibold leading-none">
                  {text}
                </span>
              </button>
            );
          })}
        </div>
        <div className="rounded-full border border-gray-300 dark:border-white/20 bg-[var(--tgui--bg_color)]/75 p-1 backdrop-blur-md">
          <button
            type="button"
            role="tab"
            aria-selected={selectedSearch}
            aria-current={selectedSearch ? "page" : undefined}
            aria-label={SEARCH_TAB.text}
            onClick={() => go(activeTab, SEARCH_TAB.key, SEARCH_TAB.to, onSelect)}
            className={[
              "flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200",
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
