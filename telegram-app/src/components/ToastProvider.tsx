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

export interface Toast {
  text: string;
  description?: string;
  before?: ReactNode;
}

interface ToastContextValue {
  show: (toast: Toast) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 3200;

/**
 * Глобальный toast-фидбек на tgui Snackbar (язык примера): фиксирован
 * над таббаром, авто-закрытие, вне потока страницы. Провайдер вешается
 * в AppConfig внутри AppRoot (Snackbar требует контекст темы tgui).
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
        <div className="fixed bottom-24 left-4 right-4 z-60 max-w-md mx-auto pointer-events-auto">
          <Snackbar
            onClose={close}
            duration={TOAST_DURATION_MS}
            before={
              toast.before ?? (
                <CheckCircle2 size={20} className="text-(--app-success) shrink-0" />
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

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
}
