import { Button, FixedLayout } from "@telegram-apps/telegram-ui";
import { ArrowLeft } from "lucide-react";
import {
  TabsBar,
  type AppTabId,
  type TabsBarProps,
} from "@/components/TabsBar/TabsBar";

// Совместимость: роутер и тесты используют TabsVariant из этого модуля.
export type { AppTabId, TabsBarProps };
export const TabsVariant = TabsBar;

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
            <span className="text-[9px] font-semibold leading-none">Назад</span>
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
    <TabsBar
      activeTab={props.activeTab}
      onSelect={props.onSelect}
      unreadCount={props.unreadCount}
    />
  );
}
