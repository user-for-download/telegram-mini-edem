import { useEffect } from "react";
import { signalAppReady } from "@/utils/telegram-adapter";
import { AppConfig } from "@/AppConfig";
import { AppRouter } from "@/router/AppRouter";

export default function App() {
  useEffect(() => {
    // READY-ORDER INVARIANT (tma-sdk-04): сигнал WebView (убирает
    // loading-скелетон Telegram) — только после первой отрисовки.
    // Вызов должен оставаться в этом post-mount эффекте: main.tsx делает
    // init → render, ready — здесь. Не переносить к await init().
    signalAppReady();
  }, []);

  return (
    <AppConfig>
      <AppRouter />
    </AppConfig>
  );
}
