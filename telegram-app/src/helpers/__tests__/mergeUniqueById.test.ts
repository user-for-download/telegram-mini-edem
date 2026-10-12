import { describe, expect, it } from "vitest";
import { mergeUniqueById } from "@/helpers/mergeUniqueById";

/**
 * Регресс H2: offset-пагинация (`skip/take`) по ЖИВОМУ списку, в который
 * новые строки встают В НАЧАЛО. Между загрузкой страницы 1 и страницы 2
 * публикуется поездка — окно сдвигается на строку, и граничная поездка
 * приезжает дважды (карточка дублируется, React ругается на повторный key),
 * а последняя поездка ленты не показывается никогда.
 *
 * Предзагрузка страницы 2 при `rootMargin: 320px` делает это штатным
 * сценарием, а не редким: страница грузится, пока предыдущая ещё на экране.
 */
const page = (ids: string[]) => ({ items: ids.map((id) => ({ id })) });

describe("mergeUniqueById: страницы offset-пагинации не дают повторов", () => {
  it("склеивает страницы в порядке появления", () => {
    const merged = mergeUniqueById([
      page(["a", "b"]),
      page(["c", "d"]),
    ]);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("выкидывает граничную строку, пришедшую на сдвиге окна", () => {
    // Страница 1 закрыта на «b»; затем публикуется «z» и всё сдвигается.
    // Страница 2 начинается с «b» — тот же id, что и последний в первой.
    const merged = mergeUniqueById([
      page(["a", "b"]),
      page(["b", "c"]),
    ]);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("переживает повтор граничной строки в соседних страницах", () => {
    const merged = mergeUniqueById([
      page(["a"]),
      page(["a", "b"]),
      page(["b", "c"]),
    ]);
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("оставляет ПЕРВОЕ вхождение: свежая копия пришла раньше", () => {
    const stale = { id: "a", seat: 1 };
    const fresh = { id: "a", seat: 9 };
    const merged = mergeUniqueById([
      { items: [fresh] },
      { items: [stale] },
    ]);
    expect(merged).toEqual([fresh]);
  });

  it("пустые страницы и отсутствие данных", () => {
    expect(mergeUniqueById(undefined)).toEqual([]);
    expect(mergeUniqueById([])).toEqual([]);
    expect(mergeUniqueById([page([])])).toEqual([]);
  });

  it("не мутирует исходные страницы", () => {
    const first = page(["a"]);
    const pages = [first];
    mergeUniqueById(pages);
    expect(first.items).toHaveLength(1);
  });
});
