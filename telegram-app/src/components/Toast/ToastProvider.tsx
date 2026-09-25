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
import { CheckCircle2 } from "lucide-react";
import { SHRINK, SUCCESS } from "@/ui/classes";
import styles from "./Toast.module.css";

export interface Toast {
  text: string;
  description?: string;
  before?: ReactNode;
  /** Ошибка/важное предупреждение — role=alert (немедленный анонс). */
  assertive?: boolean;
}

interface ToastContextValue {
  show: (toast: Toast) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 3200;

/**
 * Глобальный toast-фидбек на tgui Snackbar (язык примера): фиксирован
 * сверху по центру (низ перекрывался таббаром), авто-закрытие, вне
 * потока страницы. Отступ сверху учитывает safe-area Телеграма
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

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        // a11y: tgui Snackbar — голый div без live-семантики; обёртка
        // объявляет тост скринридеру: role=status (успех/инфо, вежливо),
        // role=alert (ошибки через assertive:true, немедленно).
        <div role={toast.assertive ? "alert" : "status"}>
          <Snackbar
            className={styles.snackbar}
            onClose={close}
            duration={TOAST_DURATION_MS}
            before={
              toast.before ?? (
                <CheckCircle2 size={20} className={`${SUCCESS} ${SHRINK}`} />
              )
            }
            description={toast.description}
          >
            {toast.text}
          </Snackbar>
        </div>
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
