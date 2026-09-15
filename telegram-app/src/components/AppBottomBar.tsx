import { Badge, Button, FixedLayout, Tabbar } from "@telegram-apps/telegram-ui";
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

/**
 * Нативный Tabbar из @telegram-apps/telegram-ui: все 5 разделов (включая
 * Поиск) в единой панели — как в официальном клиенте Telegram. Safe-area,
 * цвета темы и selected-состояние — нативные. Route-driven: активный таб
 * определяет роутер, компонент только рендерит и отдаёт выбор наружу.
 * Бейдж непрочитанных — пропом (счётчик считает роутер из кэша inbox).
 * a11y: Tabbar.Item не несёт tab-семантики, поэтому счётчик дублируем
 * в aria-label кнопки (иначе скринридер его не объявит).
 */
export function TabsVariant({
  activeTab,
  onSelect,
  unreadCount = 0,
}: TabsBarProps) {
  const items = [...TABS, SEARCH_TAB];

  return (
    <FixedLayout vertical="bottom" className="z-2!">
      {/* Овальная плавающая пилюля: скругление + боковые отступы, снизу —
          реальный инсет Телеграма (env() в WebView равен 0). overflow-hidden
          чтобы фоны айтемов не торчали из скруглённых углов. */}
      <Tabbar className="mx-4! mb-[max(env(safe-area-inset-bottom,0px),var(--tg-safe-area-inset-bottom,0px))]! rounded-[28px]! overflow-hidden!">
        {items.map(({ key, text, to, Icon }) => {
          const selected = activeTab === key;
          const showBadge = key === "notifications" && unreadCount > 0;

          return (
            <Tabbar.Item
              key={key}
              selected={selected}
              text={text}
              aria-label={showBadge ? `${text}, непрочитанных: ${unreadCount}` : text}
              onClick={() => go(activeTab, key, to, onSelect)}
            >
              {/* relative-обёртка для позиционирования Badge поверх иконки */}
              <span className="relative flex items-center justify-center">
                <Icon size={28} strokeWidth={selected ? 2.2 : 1.8} />
                {showBadge && (
                  <Badge
                    type="number"
                    mode="critical"
                    aria-hidden="true"
                    className="absolute -top-1.5 -right-2 pointer-events-none"
                  >
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </Badge>
                )}
              </span>
            </Tabbar.Item>
          );
        })}
      </Tabbar>
    </FixedLayout>
  );
}

/**
 * Действие вместо табов (страница «Создание поездки»): геометрия 1:1 как
 * у табов — кнопка-овал слева (flex-1, тот же силуэт пилюли таббара:
 * высота 56px + radius 28px), круг-назад справа отдельным кругом
 * (на месте круга поиска). Accessible name кнопки — label страницы
 * («Опубликовать»): селектор e2e/telegram-parity.mjs продолжает находить
 * кнопку после переезда из sticky-CTA в бар. loading/disabled блокируют
 * повторный submit.
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
    <FixedLayout vertical="bottom" className="z-2! w-full pointer-events-none">
      <div className="mx-auto flex w-full max-w-md items-center gap-2 px-4 pb-[max(env(safe-area-inset-bottom,0px),var(--tg-safe-area-inset-bottom,0px))] pointer-events-auto">
        <Button
          mode="filled"
          size="l"
          stretched
          loading={loading}
          disabled={blocked}
          onClick={handleSubmit}
          className="min-h-14! flex-1 rounded-[28px]!"
        >
          {label}
        </Button>
      <div className="rounded-full border border-gray-300 dark:border-white/20 bg-(--tgui--bg_color)/75 p-1 backdrop-blur-md">
        <button
          type="button"
          aria-label="Назад"
          onClick={onBack}
          className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-full transition-all duration-200 bg-transparent text-(--tgui--text_color) active:scale-95"
        >
          <ArrowLeft size={22} strokeWidth={1.8} />
          <span className="text-[9px] font-semibold leading-none">
            Назад
          </span>
        </button>
      </div>
      </div>
    </FixedLayout>
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
