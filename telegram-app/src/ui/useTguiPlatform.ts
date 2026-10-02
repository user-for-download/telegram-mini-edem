import { useLaunchParams } from "@tma.js/sdk-react";
import { resolveAppRootPlatform, useDevPlatform } from "@/utils/devPlatform";

/**
 * Платформа telegram-ui для AppRoot и для фасадных компонентов, которым
 * нужна та же разметка, что у кита (ui/Section повторяет заголовок секции).
 *
 * AppRoot 2.1.x принимает только 'base' | 'ios': iOS — нативный вид,
 * всё остальное (Android, десктоп, веб) — нейтральный 'base'. Dev-стенд
 * может принудительно задать платформу кнопками в шапке (utils/devPlatform)
 * — оверрайд важнее клиента.
 *
 * Живёт здесь, а не в AppConfig, чтобы AppRoot и фасад считали ОДНО и то же:
 * у кита usePlatform не экспортируется из корня, пробросить значение
 * контекстом значило бы дублировать источник правды.
 */
export function useTguiPlatform(): "base" | "ios" {
  const devPlatform = useDevPlatform();
  let client: "base" | "ios" = "base";
  try {
    const p = useLaunchParams().tgWebAppPlatform;
    if (p === "ios") client = "ios";
  } catch {
    // launch params недоступны (крайний случай) — нейтральный base.
  }
  return resolveAppRootPlatform(devPlatform, client);
}
