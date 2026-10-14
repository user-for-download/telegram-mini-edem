import { describe, expect, it } from "vitest";
import {
  REPORT_CATEGORIES,
  REPORT_STATUSES,
  REPORT_TARGET_TYPES,
} from "@edem/contracts";

import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
} from "./labels";

// Регрессионный пин: каждый статус/категория/тип цели жалобы обязан иметь
// русскую подпись, отличную от сырого идентификатора. Иначе новое значение
// из справочника снова попадёт в UI англоязычным (audit-находка).
describe("reports — русские подписи enum", () => {
  const cases = [
    { name: "status", values: REPORT_STATUSES, labels: REPORT_STATUS_LABELS },
    { name: "category", values: REPORT_CATEGORIES, labels: REPORT_CATEGORY_LABELS },
    {
      name: "targetType",
      values: REPORT_TARGET_TYPES,
      labels: REPORT_TARGET_TYPE_LABELS,
    },
  ] as const;

  for (const { name, values, labels } of cases) {
    it(`${name}: подпись задана и не равна сырому значению`, () => {
      for (const value of values) {
        const label = (labels as Record<string, string | undefined>)[value];
        expect(label, `${name}.${value}`).toBeTruthy();
        expect(label, `${name}.${value}`).not.toBe(value);
      }
    });
  }
});
