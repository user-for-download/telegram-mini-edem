import type { ReactNode } from "react";
import { Badge, Button, FixedLayout } from "@telegram-apps/telegram-ui";
import { hapticFeedback } from "@telegram-apps/sdk-react";
import { ArrowLeft, Bell, Car, Home, Search, User } from "lucide-react";

export type AppTabId = "home" | "trips" | "notifications" | "search" | "profile";

export interface TabsBarProps {
  activeTab: AppTabId;
  onSelect: (to: string) => void;
  unreadCount?: number;
}

export interface ActionBarProps {
  label: string;
  onBack: () => void;
  onSubmit: () => void;
  loading: boolean;
  disabled: boolean;
}

export type AppBottomBarProps =
  | ({ variant: "tabs" } & TabsBarProps)
  | ({ variant: "action" } & ActionBarProps);

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
  "bg-transparent text-(--tgui--text_color) active:scale-95";
// Активный таб: только цвет иконки, круглой заливки нет.
const activeBtn =
  "-translate-y-1 bg-transparent text-(--tgui--button_color)";

/**
 * Общий каркас бара: FixedLayout bottom + центрированная колонка max-w-md
 * с safe-area отступом снизу. Содержимое (табы или действие) — в children.
 */
function BottomBarFrame({ children }: { children: ReactNode }) {
  return (
    <FixedLayout vertical="bottom" className="z-2! w-full pointer-events-none">
      <div className="mx-auto flex w-full max-w-md items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom,0px),var(--tg-safe-area-inset-bottom,0px))] pointer-events-auto">
        {children}
      </div>
    </FixedLayout>
  );
}

/**
 * Табы — переезд AppTabbar 1:1 (язык образца): прозрачная пилюля с блюром,
 * четыре раздела в пилюле, Поиск — отдельным кругом справа. Route-driven:
 * активный таб определяет роутер, компонент только рендерит и отдаёт выбор
 * наружу. Бейдж непрочитанных — пропом (счётчик считает роутер из кэша inbox).
 */
export function TabsVariant({
  activeTab,
  onSelect,
  unreadCount = 0,
}: TabsBarProps) {
  const selectedSearch = activeTab === SEARCH_TAB.key;
  return (
    <BottomBarFrame>
      <div
        role="tablist"
        aria-label="Основные разделы"
        className="flex flex-1 items-center justify-around gap-1 rounded-[28px] border border-gray-300 dark:border-white/20 bg-(--tgui--bg_color)/75 px-2 py-1 backdrop-blur-md"
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
                  className="absolute right-0.5 top-0.5 m-0! pointer-events-none"
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
      <div className="rounded-full border border-gray-300 dark:border-white/20 bg-(--tgui--bg_color)/75 p-1 backdrop-blur-md">
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
    </BottomBarFrame>
  );
}

/**
 * Действие вместо табов (страница «Создание поездки»): круг-назад слева
 * (та же логика goBack, что у Shell) + растянутая filled-кнопка справа.
 * Accessible name кнопки — label страницы («Опубликовать»): селектор
 * e2e/telegram-parity.mjs продолжает находить кнопку после переезда из
 * sticky-CTA в бар. loading/disabled блокируют повторный submit.
 */
export function ActionVariant({
  label,
  onBack,
  onSubmit,
  loading,
  disabled,
}: ActionBarProps) {
  const blocked = loading || disabled;
  const handleSubmit = () => {
    if (loading || disabled) return;
    onSubmit();
  };
  return (
    <BottomBarFrame>
      <div className="flex flex-1 items-center gap-2 rounded-[28px] border border-gray-300 dark:border-white/20 bg-(--tgui--bg_color)/75 px-2 py-1 backdrop-blur-md">
        <button
          type="button"
          aria-label="Назад"
          onClick={onBack}
          className={[
            "flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-all duration-200",
            idleBtn,
          ].join(" ")}
        >
          <ArrowLeft size={22} strokeWidth={1.8} />
        </button>
        <Button
          mode="filled"
          size="m"
          stretched
          loading={loading}
          disabled={blocked}
          onClick={handleSubmit}
          className="min-h-11"
        >
          {label}
        </Button>
      </div>
    </BottomBarFrame>
  );
}

/**
 * Нижний бар: variant "tabs" — обычные разделы, variant "action" —
 * контекстная кнопка страницы (реестр bottomBarRegistry, выбор — в Shell).
 */
export function AppBottomBar(props: AppBottomBarProps) {
  if (props.variant === "action") {
    return (
      <ActionVariant
        label={props.label}
        onBack={props.onBack}
        onSubmit={props.onSubmit}
        loading={props.loading}
        disabled={props.disabled}
      />
    );
  }
  return (
    <TabsVariant
      activeTab={props.activeTab}
      onSelect={props.onSelect}
      unreadCount={props.unreadCount}
    />
  );
}
