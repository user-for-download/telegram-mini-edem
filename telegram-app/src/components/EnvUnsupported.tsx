// Вне Telegram (прод-сборка): init data и launch params отсутствуют,
// SDK бросает при retrieveLaunchParams — показываем объяснение.
// Нативный Placeholder (без AppRoot-контекста он самодостаточен).
import { Placeholder } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";


export function EnvUnsupported() {
  return (
    <Placeholder
      header="«Едем» — мини-приложение Telegram"
      description="Откройте его через кнопку бота @edem_mini_bot в Telegram."
      action={
        <Button
          size="l"
          Component="a"
          href="https://t.me/edem_mini_bot"
        >
          Открыть бота
        </Button>
      }
    />
  );
}
