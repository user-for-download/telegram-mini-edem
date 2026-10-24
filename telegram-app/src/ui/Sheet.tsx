import { useEffect, useId, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Headline, Modal, VisuallyHidden } from "@telegram-apps/telegram-ui";
import type { ModalProps } from "@telegram-apps/telegram-ui";
import { usePlatform } from "@/hooks/usePlatform";
import styles from "./ui.module.css";
import titleStyles from "./SheetTitle.module.css";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** Текстовый заголовок — идёт в accessible name, только строка. */
  title: string;
  /**
   * Тело шторки: "padded" (по умолчанию) — скролл 82dvh и бока 16;
   * "edge" — без боковых (контент сам держит рельс: отзывы, досье);
   * "flush" — без нижнего паддинга: экран сам рисует закреплённую нижнюю
   * панель (детали поездки);
   * "static" — без скролла (короткая форма обратной связи).
   */
  variant?: "padded" | "edge" | "flush" | "static";
  /**
   * Шторка открывается ПОВЕРХ уже открытой шторки (подтверждение поверх
   * «Автомобиля»/«Заявок»). Кит переключает `Drawer.Root` на
   * `Drawer.NestedRoot` — вложенный корень живёт на drag/openChange
   * родителя, а не заводит собственный. Ставить можно ТОЛЬКО внутри другой
   * открытой `Drawer.Content`: `NestedRoot` читает контекст родительского
   * драуера и без него получает заглушки (`vaul-with-scroll-fix/dist/index.mjs`:
   * дефолт контекста `onNestedDrag: () => {}`).
   */
  nested?: boolean;
  children: ReactNode;
}

const BODY_VARIANTS = {
  padded: styles.sheetBody,
  edge: styles.sheetBodyEdge,
  flush: styles.sheetBodyFlush,
  static: styles.sheetBodyStatic,
} as const;

/**
 * Единая bottom-sheet шторка приложения: Modal + имя диалога + видимый
 * заголовок + тело. Все всплывающие окна идут через неё и не дублируют
 * обвязку (счёт потребителей не пишу: он гниёт — уже дважды менялся, а
 * реестр ниже в README перечисляет отклонения, а не список потребителей).
 * Исключение было одно: `ReportDetailsModal` собирался на сыром китовом
 * Modal и на Android/десктопе открывался без видимого заголовка — причина
 * была не продуктовая (переезд случился заодно с переписыванием тела), и в
 * 2026-10-13 поправлено переводом на фасад.
 *
 * Единственное имя диалога: скрытый h2 (titleId, уходит в aria-labelledby
 * модалки). Видимые копии заголовка скрыты от скринридера — копия
 * в Modal.Header (рендерится только на iOS) обёрнута в aria-hidden span,
 * копия Headline на base — aria-hidden. Интерактивного содержимого
 * в заголовке быть не должно.
 *
 * Modal смонтирован всегда (анимация закрытия не теряется). Хуки
 * (платформа, фокус) живут в SheetContent: кит кладёт children в
 * Drawer.Content, который в ЗАКРЫТОМ состоянии не смонтирован вовсе —
 * закрытая шторка платформу не читает, SSR не падает.
 *
 * Уточнение, важное для поведения при закрытии: «не смонтирован, пока
 * открыт» НЕ значит «размонтируется в кадр закрытия». Radix `Presence`
 * (под ним vaul) держит узел живым до конца exit-анимации:
 * `mounted --ANIMATION_OUT--> unmountSuspended --ANIMATION_END--> unmounted`,
 * и `isPresent` на `unmountSuspended` ещё true. Поэтому вызывающий может
 * держать прежнее содержимое (паттерн `retained` в ReportDetailsModal и
 * UserProfileSheet) — окно уедет непустым. Мгновенного размонтирования
 * не будет только если CSS-анимации нет вовсе (`animation-name: none`) —
 * в jsdom и SSR анимаций нет, поэтому проверять удержание там нельзя.
 *
 * Тело — div со скроллом из --app-sheet-* токенов; при открытии переносим
 * на него фокус (tabIndex={-1}, вне таб-порядка): точка входа для
 * клавиатуры и скринридера. Дальше — нативный trap vaul (Tab внутри
 * шторки, Esc — закрыть).
 *
 * ВОЗВРАТ ФОКУСА. Раньше здесь стояло «фокус возвращается на триггер», и
 * это было неправдой: Sheet ничего не передавал киту в `trigger`, а без
 * него `Drawer.Trigger` не рендерится и `context.triggerRef.current`
 * остаётся `null`. Ветка Radix `context.triggerRef.current?.focus()`
 * (`@radix-ui/react-dialog/dist/index.mjs:154-157`) на этом молча
 * ничего не делает, но `event.preventDefault()` всё равно ставит — и
 * единственный откат FocusScope
 * (`@radix-ui/react-focus-scope/dist/index.mjs:98-100`,
 * `focus(previouslyFocusedElement ?? document.body)`) тоже отменяется.
 * Собственный откат FocusScope не спасает и по существу: его снимок
 * `document.activeElement` снимается в эффекте самого FocusScope, а
 * эффекты идут снизу вверх, так что к его моменту фокус уже на теле
 * шторки (SheetContent ниже по дереву).
 *
 * Поэтому триггер не нужен вовсе: Sheet запоминает активный элемент в
 * момент открытия (до переноса фокуса на тело) и возвращает фокус в
 * `onCloseAutoFocus`. Это ещё и единственный вариант, работающий для
 * route-backed и программно открытых шторок (deep-link на /vehicle,
 * /trips/my/:id/requests) — у них триггера нет вовсе.
 * `trigger` кита здесь неприменим ещё и потому, что его `Drawer.Trigger`
 * = `DialogPrimitive.Trigger` с кликом в `onOpenChange(true)`, а Sheet
 * открыт управляемо (`open` пропом) и этот вызов игнорирует: обёртка
 * вокруг кнопки вызывающего не открыла бы шторку.
 */
export function Sheet({
  open,
  onClose,
  title,
  variant = "padded",
  nested = false,
  children,
}: SheetProps) {
  const titleId = useId();
  // Кто открыл шторку — заполняет SheetContent ДО переноса фокуса на тело.
  const openerRef = useRef<HTMLElement | null>(null);

  // `ModalProps` кита объявлен как `HTMLAttributes<HTMLDivElement>` и НЕ
  // включает Radix-специфичные пропсы `Drawer.Content` — хотя сам Modal.js
  // раскладывает `...restProps` именно в `Drawer.Content` (проверено:
  // dist/components/Overlays/Modal/Modal.js), где onCloseAutoFocus и живёт.
  // Механизм верный, не хватает только типа — поэтому объявляем проп у себя
  // и прокидываем узким cast, не меняя поведение.
  const handleCloseAutoFocus = (event: Event) => {
    // preventDefault обязателен: иначе цепочка composeEventHandlers доходит
    // до ветки Radix с `triggerRef.current === null`, которая снова ставит
    // preventDefault и глушит откат FocusScope.
    event.preventDefault();
    const opener = openerRef.current;
    // Триггер мог размонтироваться (строка списка ушла после подтверждения) —
    // тогда фокус просто остаётся там, где был.
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  };
  const focusRestore = {
    onCloseAutoFocus: handleCloseAutoFocus,
  } as Partial<ModalProps>;

  return (
    <Modal
      open={open}
      nested={nested}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      {...focusRestore}
      header={
        <Modal.Header>
          <span aria-hidden="true">{title}</span>
        </Modal.Header>
      }
      aria-labelledby={titleId}
    >
      <SheetContent
        titleId={titleId}
        title={title}
        variant={variant}
        openerRef={openerRef}
      >
        {children}
      </SheetContent>
    </Modal>
  );
}

function SheetContent({
  titleId,
  title,
  variant,
  openerRef,
  children,
}: {
  titleId: string;
  title: string;
  variant: NonNullable<SheetProps["variant"]>;
  /** Общий с Sheet: сюда кладём «кто открыл», читает onCloseAutoFocus. */
  openerRef: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const platform = usePlatform();
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Снимок ДО переноса фокуса на тело — дальше активным уже оно само.
    // body игнорируем: программное открытие без фокуса не должно
    // возвращать фокус «в никуда».
    const active = document.activeElement;
    openerRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    bodyRef.current?.focus({ preventScroll: true });
  }, [openerRef, bodyRef]);

  return (
    <div ref={bodyRef} tabIndex={-1} className={BODY_VARIANTS[variant]}>
      {/* Имя диалога для скринридера — на всех платформах. */}
      <VisuallyHidden Component="h2" id={titleId}>
        {title}
      </VisuallyHidden>
      {platform !== "ios" && (
        <Headline
          Component="p"
          weight="2"
          aria-hidden="true"
          className={titleStyles.title}
        >
          {title}
        </Headline>
      )}
      {children}
    </div>
  );
}
