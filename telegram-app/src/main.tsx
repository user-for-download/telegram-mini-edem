// tgui-стили подключаются в index.css в слое `tgui` (см. комментарий там):
// неслойное бьёт слойное всегда, поэтому порядок импортов здесь на каскад
// не влияет — прямой импорт styles.css убран (был единственным местом).
import ReactDOM from "react-dom/client";
import { StrictMode } from "react";
import { retrieveLaunchParams } from "@tma.js/sdk-react";

import { EnvUnsupported } from "@/components/EnvUnsupported.tsx";
import { init } from "@/init.ts";
import App from "@/App.tsx";

import "./index.css";

// Мок окружения для разработки в обычном браузере. Работает только при
// import.meta.env.DEV (tree-shaken в проде) — см. mockEnv.ts.
import "./mockEnv.ts";
import { initErrorReporting } from "@/utils/reportError.ts";

// Репортёр ошибок — до рендера, чтобы ловить сбои инициализации.
initErrorReporting();

const root = ReactDOM.createRoot(document.getElementById("root")!);

try {
  const launchParams = retrieveLaunchParams();
  const { tgWebAppPlatform: platform } = launchParams;

  // READY-ORDER INVARIANT (tma-sdk-04): init → render(<App/>) → effect(ready).
  // Скелетон Telegram должен гаснуть только после первой отрисовки:
  // signalAppReady() живёт в useEffect App (после маунта) и НЕ должен
  // переезжать сюда (до/рядом с await init) — иначе скелетон погаснет
  // поверх пустого WebView. Порядок ниже не менять.
  await init({
    debug: import.meta.env.DEV,
    mockForMacOS: platform === "macos",
  }).then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
} catch {
  root.render(<EnvUnsupported />);
}
