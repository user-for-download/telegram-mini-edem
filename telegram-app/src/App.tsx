import { useEffect } from "react";
import { signalAppReady } from "@/utils/telegram-adapter";
import { AppConfig, ErrorFallback } from "@/AppConfig";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AppRouter } from "@/router/AppRouter";

export default function App() {
  useEffect(() => {
    // READY-ORDER INVARIANT (tma-sdk-04): сигнал WebView (убирает
    // loading-скелетон Telegram) — только после первой отрисовки.
    // Вызов должен оставаться в этом post-mount эффекте: main.tsx делает
    // init → render, ready — здесь. Не переносить к await init().
    signalAppReady();
  }, []);

  // Граница здесь, а не внутри AppConfig: внутри она не ловила падение
  // самого AppConfig (его хуки и вычисление темы) — пользователь получал
  // пустой экран без единого слова. Замер: 0 символов текста, 2 узла в body.
  return (
    <ErrorBoundary fallback={ErrorFallback}>
      <AppConfig>
        <AppRouter />
      </AppConfig>
    </ErrorBoundary>
  );
}
