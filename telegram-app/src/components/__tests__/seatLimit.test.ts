// Лимит мест в поездке — константа контракта MAX_SEATS, а не литерал.
//
// Зачем вообще пин: RideRequestsList (форма правки заявки) держал `max="3"`
// литералом, тогда как RideRequestFields и EditTripForm оба брали
// MAX_SEATS. Смена MAX_SEATS в контракте тихо оставила бы форму правки на
// старом лимите — и zod отбил бы значение, которое поле само же разрешило
// ввести.
//
// Почему пин на текст исходника, а не на DOM: пока MAX_SEATS === 3,
// `max="3"` и `max={MAX_SEATS}` неразличимы — оба дают атрибут max="3",
// и рендер-тест остался бы зелёным на хардкоде. Единственный способ
// поймать расхождение ДО bump'а контракта — не дать числовому лимиту
// появиться в исходнике вообще. Прецедент: targetSizes.test.tsx,
// layoutCss.test.ts («ловлю текстом»).
//
// Обратная сторона: любая из трёх форм обязана ссылаться на MAX_SEATS,
// иначе тест выше потеряет смысл (у формы может не быть поля max —
// селект мест вместо number-ввода, как в RideRequestFields).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MAX_SEATS } from "@edem/contracts";

/** Все формы, где пользователь задаёт число мест. */
const SEAT_FORMS = [
  "src/components/Trip/RideRequestFields.tsx",
  "src/components/Trip/EditTripForm.tsx",
  "src/components/Trip/RideRequestsList.tsx",
] as const;

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const readSource = (file: string): string =>
  readFileSync(join(root, file), "utf8");

// Ловим именно ДРЕЙФ ОТ КОНТРАКТА — литерал, равный текущему MAX_SEATS, в
// виде `max="3"` или `max={3}`. Значение берётся из контракта на момент
// запуска, поэтому смена MAX_SEATS пересобирает шаблон сам.
//
// Почему не «любое число в max»: в EditTripForm законные литералы —
// `max="168"` (часы) и `max="20000"`/`"100000"` (цена). Пин на «число
// есть» сразу дал бы ложное срабатывание на них и отвлекал бы от сути.
const seatCapLiteral = new RegExp(
  `max="(${MAX_SEATS})"|max=\\{${MAX_SEATS}\\}`,
);

describe("лимит мест берётся из контракта", () => {
  it("контракт задаёт лимит мест, ради которого пин и написан", () => {
    expect(MAX_SEATS).toBeGreaterThan(0);
  });

  it.each(SEAT_FORMS)("%s: значение лимита не зашито числом", (file) => {
    expect(readSource(file)).not.toMatch(seatCapLiteral);
  });

  it.each(SEAT_FORMS)("%s: ссылается на MAX_SEATS", (file) => {
    expect(readSource(file)).toContain("MAX_SEATS");
  });
});
