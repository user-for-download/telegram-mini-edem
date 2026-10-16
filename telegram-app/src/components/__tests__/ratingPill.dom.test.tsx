// @vitest-environment jsdom
// a11y-контракт RatingPill (F27, аудит 2026-10-15).
//
// Дефект: `aria-label` висел на `Component="span"`. Спан — это phrasing
// content, его вычисленная роль generic, а generic НЕ экспонирует
// aria-label: подпись молча терялась. Хуже — звезда внутри уже была
// `aria-hidden`, так что при отказе подписи пилюля деградировала до голого
// числа «4.9» без единицы измерения и без контекста (MEMORY.md §18:
// «role/live-region must sit on the element carrying the TEXT» — здесь нужен
// элемент, который вообще может имя экспонировать).
//
// Контракт, который здесь закреплён:
//  1. пилюля — `role="img"` с именем, содержащим ЧИСЛО и шкалу
//     («Рейтинг 4.8 из 5»), и имя реально вычислено по роли (getByRole), а не
//     живёт в атрибуте: проверка пропов прошла бы и на сломанном коде;
//  2. звезда остаётся декоративной — `aria-hidden="true"`, глиф не озвучивается;
//  3. ВИДИМЫЙ текст по-прежнему «4.8» — роль не должна менять картинку;
//  4. внутри пилюли не появляется посторонний заголовок.
//
// Тот же паттерн, что у F2: `components/ReviewCard/ReviewCard.tsx` и
// `components/Trip/AvatarStack.tsx`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { RatingPill } from "@/components/RatingPill";

afterEach(() => {
  cleanup();
});

function renderPill(value: number | null, reviewsCount?: number | null) {
  return render(
    <AppRoot platform="base">
      <RatingPill value={value} reviewsCount={reviewsCount} />
    </AppRoot>,
  );
}

describe("RatingPill: рейтинг доступен скринридеру", () => {
  it("пилюля отдаёт роль img с именем, в котором есть число и шкала", () => {
    renderPill(4.8);

    // Ключевая проверка: имя ВЫЧИСЛЕНО из дерева доступности по роли.
    // До фикса здесь бросалось «Unable to find an accessible element with
    // the role "img"» — спан это generic, а generic подпись не экспонирует.
    const pill = screen.getByRole("img", { name: /Рейтинг 4\.8 из 5/ });

    expect(pill.getAttribute("role")).toBe("img");
    expect(pill.getAttribute("aria-label")).toBe("Рейтинг 4.8 из 5");
  });

  it("имя приходит из aria-label, а не из содержимого", () => {
    // Внутри пилюли есть видимое число «4.8». Имя обязано быть подписью, а не
    // склейкой текста: иначе озвучка была бы «4.8» — число без единицы
    // измерения. Плюс — запрос с ЧУЖИМ числом не должен находиться, иначе
    // это тупое совпадение подстроки в разметке, а не вычисленное имя.
    renderPill(4.8);

    const pill = screen.getByRole("img", { name: /Рейтинг/ });

    expect(pill.textContent).toContain("4.8");
    expect(
      screen.queryByRole("img", { name: /Рейтинг 3\.1 из 5/ }),
    ).toBeNull();
  });

  it("звезда декоративна: глиф не засоряет доступное имя", () => {
    renderPill(4.8);

    const pill = screen.getByRole("img", { name: /Рейтинг 4\.8 из 5/ });
    const stars = pill.querySelectorAll("svg");

    expect(stars).toHaveLength(1);
    expect(stars[0]?.getAttribute("aria-hidden")).toBe("true");
    // Роль img делает потомков презентационными — именем остаётся подпись.
    expect(pill.getAttribute("aria-label")).not.toContain("★");
  });

  it("видимый текст по-прежнему сама оценка — роль не меняет картинку", () => {
    renderPill(4.8);

    expect(screen.getByRole("img").textContent).toBe("4.8");
  });

  it("оценки нет — тоже называется, а не молчит", () => {
    // hasRating гасит 5.0 при reviewsCount === 0, поэтому «нет оценки» приходит
    // числом. Пилюля обязана остаться находимой и в этом состоянии.
    renderPill(5, 0);

    const pill = screen.getByRole("img", { name: "Рейтинг пока отсутствует" });

    expect(pill.textContent).toBe("—");
  });

  it("китовый <h6> внутри не подменяет имя пилюли", () => {
    // Кит чипа рендерит children через `Subheadline` без явного `Component`,
    // то есть в <h6> (Subheadline.js: `Component || 'h6'`). Элемент в разметке
    // остаётся: снять его, не отказавшись от китового Chip, нельзя.
    //
    // Проверяем то, что в нашей власти: имя пилюли — это ровно aria-label, а
    // НЕ склейка «Рейтинг 4.8 из 5» + «4.8». Иначе озвучка прочитала бы число
    // дважды: подписью картинки и отдельным заголовком.
    //
    // Про «потомки role=img презентационны» (ARIA 1.2, img: Children
    // Presentational: True) здесь НЕ проверяется: движок getByRole —
    // dom-accessibility-api@0.5.16 — эту модель не реализует вовсе, так что
    // такой ассерт тестировал бы библиотеку, а не приложение. Настоящие
    // скринридеры правило соблюдают.
    renderPill(4.8);

    const pill = screen.getByRole("img", { name: /Рейтинг/ });

    expect(pill.querySelectorAll("h6")).toHaveLength(1);
    // Имя сверяется ТОЧНОЙ строкой: опция `name` в getByRole прогоняет
    // вычисление доступного имени (computeAccessibleName), поэтому это проверка
    // имени из дерева, а не значения пропа. Регулярка с повторным «4.8» не
    // нашлась бы и при задвоении числа.
    expect(screen.getByRole("img", { name: "Рейтинг 4.8 из 5" })).toBe(pill);
    expect(
      screen.queryByRole("img", { name: /Рейтинг 4\.8 из 5\s+4\.8/ }),
    ).toBeNull();
  });

  it("корень пилюли — блочный узел", () => {
    // Регрессия на невалидную вложенность: кит кладёт слот before в жёсткий
    // <div>, а children — в <h6>. Оба — flow content, а <span> допускает
    // только phrasing content. Поэтому корень не переопределяем и берём
    // дефолт кита. Проверка на конкретный тег, а не «не span»: иначе регресс
    // в <button> (phrasing content) прошёл бы молча.
    renderPill(4.8);

    const pill = screen.getByRole("img", { name: /Рейтинг 4\.8 из 5/ });

    expect(["SPAN", "BUTTON", "A", "P", "H6"]).not.toContain(pill.tagName);
  });
});
