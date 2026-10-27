// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { CitySelectField } from "@/components/CitySelect/CitySelectField";

afterEach(cleanup);
describe("CitySelectField: clear optional city", () => {
  it.each([false, true])("пустая опция доступна только при required=%s false", (required) => {
    const onChange = vi.fn();
    render(<AppRoot platform="base"><CitySelectField id="city" label="Откуда" placeholder="Любой город" valueId="c-1" cities={[{ id: "c-1", name: "Москва" }]} onChange={onChange} required={required} /></AppRoot>);
    const select = screen.getByRole("combobox", { name: "Откуда" }) as HTMLSelectElement;
    const blank = select.querySelector('option[value=""]') as HTMLOptionElement;
    expect(blank.disabled).toBe(required);
    expect(blank.hidden).toBe(required);
    if (!required) {
      fireEvent.change(select, { target: { value: "" } });
      expect(onChange).toHaveBeenCalledWith("");
    }
  });
});
