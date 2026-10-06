// iOS-ветка ui/Field: кит рисует header (FormInputTitle) только на base
// (см. FormInput.js), поэтому видимую подпись показывает сам Field.
// Один label на поле: скрыт на base, текст на iOS. Мок платформы —
// тот же приём, что в section.ios.test.tsx.
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { Input } from "@telegram-apps/telegram-ui";
import { Field } from "../Field";

vi.mock("@/hooks/usePlatform", () => ({ usePlatformOrBase: () => "ios" }));

describe("Field iOS", () => {
  it("label видимый, привязан к контролу, дубля от кита нет", () => {
    const html = renderToString(
      <AppRoot platform="ios">
        <Field label="Адрес" id="f-1">
          {(field) => <Input {...field} value="" onChange={() => {}} />}
        </Field>
      </AppRoot>,
    );
    expect(html).toContain("fieldLabel");
    expect(html).toMatch(/<label[^>]*for="f-1"[^>]*>Адрес</);
    // Кит header на iOS не рисует: видимая подпись ровно одна.
    expect(html.match(/Адрес/g)).toHaveLength(1);
  });
});
