// Тесты EmptyState. До этого файл проверял ТОЛЬКО словарь текстов
// (emptyStates.test.ts), а сам компонент не был зарендерен ни одним тестом
// ui/ — при том что это единственная точка «пусто / терминально / промо».
// SSR renderToString, паттерн ui/__tests__/primitives.test.tsx.
//
// Что здесь защищаем: контракт 1:1 с китовым Placeholder (обёртка не имеет
// права изменить вид — иначе она не обёртка) и все три слота Placeholder.
import type { ReactNode } from "react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button } from "@/ui/Button";
import { EmptyState } from "@/ui/EmptyState";

const render = (node: ReactNode): string =>
  renderToString(<AppRoot platform="base">{node}</AppRoot>);

/** Текст без SSR-разделителей `<!-- -->` между соседними выражениями. */
const textOf = (html: string): string => html.replace(/<!-- -->/g, "");

describe("EmptyState: контракт 1:1 с китовым Placeholder", () => {
  it("делегирует киту (его классы в разметке, наших — нет)", () => {
    const html = render(<EmptyState header="Пока пусто" />);
    // Кит-классы на месте → Placeholder реально отрисован, а не заглушка.
    expect(html).toMatch(/tgui-[a-z0-9]+/);
    // Обёртка не добавляет собственной разметки/класса: вид остаётся китовым.
    expect(html).not.toMatch(/class="[^"]*emptyState/);
  });

  it("передаёт description в слот описания кита", () => {
    const html = render(
      <EmptyState header="Нет поездок" description="Создайте первую" />,
    );
    const text = textOf(html);
    expect(text).toContain("Нет поездок");
    expect(text).toContain("Создайте первую");
  });

  it("description необязателен: без него — только заголовок", () => {
    const text = textOf(render(<EmptyState header="Только заголовок" />));
    expect(text).toContain("Только заголовок");
  });

  it("слот action прокидывается 1:1 (кнопка наша, но рендерит её Placeholder)", () => {
    const html = render(
      <EmptyState
        header="Нет заявок"
        action={<Button variant="primary">Создать поездку</Button>}
      />,
    );
    const text = textOf(html);
    expect(text).toContain("Создать поездку");
    // Кнопка действия — ui/Button, значит несёт наш тап-таргет.
    expect(html).toContain('data-tap-target="44"');
  });

  it("слот children (пояснение «почему пусто») рендерится", () => {
    // Реальный потребитель — TripRequestsModal: оффлайн-подсказка.
    const html = render(
      <EmptyState header="Нет заявок">
        <span>Вы офлайн — список обновится при подключении</span>
      </EmptyState>,
    );
    expect(textOf(html)).toContain("Вы офлайн — список обновится при подключении");
  });

  it("пустое состояние без action и children рендерится без ошибок", () => {
    const text = textOf(render(<EmptyState header="Пусто" />));
    expect(text).toContain("Пусто");
  });
});
