import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from "react";
import { Snackbar } from "@telegram-apps/telegram-ui";
import { CheckCircle2, CircleAlert, Info } from "lucide-react";
import { INFO, SHRINK, SUCCESS } from "@/ui/classes";
import styles from "./Toast.module.css";

export interface Toast {
  text: string;
  description?: string;
  before?: ReactNode;
  /** Ошибка/важное предупреждение — role=alert (немедленный анонс). */
  assertive?: boolean;
  /** Смысл сообщения отделён от срочности анонса. */
  tone?: "success" | "error" | "info";
}

interface ToastContextValue {
  show: (toast: Toast) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 3200;

/**
 * Глобальный toast-фидбек на tgui Snackbar (язык примера): фиксирован
 * снизу по центру НАД доком таббара, авто-закрытие, вне потока страницы.
 * Отступ снизу учитывает геометрию дока и safe-area Телеграма
 * (Toast.module.css). Провайдер вешается в AppConfig внутри AppRoot
 * (Snackbar требует контекст темы tgui).
 */
export const ToastProvider: FC<PropsWithChildren> = ({ children }) => {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback((next: Toast) => {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);

  const value = useMemo(() => ({ show }), [show]);
  const tone = toast?.tone ?? (toast?.assertive ? "error" : "success");
  const assertive = toast?.assertive ?? tone === "error";

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        // a11y: tgui Snackbar — голый div без live-семантики, поэтому роль
        // даём ЕМУ САМОМУ, а не обёртке: AppRoot рендерит Snackbar через
        // портал, и роль на обёртке висела бы на пустом узле.
        //
        // Snackbar наследует HTMLAttributes<HTMLDivElement> и спредит
        // ...restProps, поэтому role и aria-live приходят прямо на узел тоста.
        <Snackbar
          className={styles.snackbar}
          role={assertive ? "alert" : "status"}
          aria-live={assertive ? "assertive" : "polite"}
          data-tone={tone}
          onClose={close}
          duration={TOAST_DURATION_MS}
          before={
            toast.before ?? (
              tone === "error" ? (
                <CircleAlert size={20} className={`${styles.errorIcon} ${SHRINK}`} />
              ) : tone === "info" ? (
                <Info size={20} className={`${INFO} ${SHRINK}`} />
              ) : (
                <CheckCircle2 size={20} className={`${SUCCESS} ${SHRINK}`} />
              )
            )
          }
          description={toast.description}
        >
          {toast.text}
        </Snackbar>
      )}
    </ToastContext.Provider>
  );
};

/**
 * Хук доступа к тостам (вне провайдера — исключение, fail-fast).
 */
export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
