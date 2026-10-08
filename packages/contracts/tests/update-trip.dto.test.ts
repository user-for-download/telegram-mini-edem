import { describe, it, expect } from "vitest";
import { updateTripDtoSchema } from "../src/dto/trip.dto";

/**
 * PATCH /trips/:id: правила обновления:
 *  - все поля опциональны (partial);
 *  - маршрут (`fromCity`/`fromCityId`/`toCity`/`toCityId`) ЗАПРЕЩЁН
 *    к изменению. Водитель должен удалить поездку и создать новую.
 *  - флаги опций (`autoComplete`/`matchingEnabled`) РЕДАКТИРУЕМЫ
 *    (решение владельца 2026-10-08), но без `.default()`: отсутствие ключа
 *    = «не трогать».
 */
describe("updateTripDtoSchema", () => {
  it("accepts empty payload (no-op)", () => {
    const result = updateTripDtoSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts partial update with seatsTotal only", () => {
    const result = updateTripDtoSchema.safeParse({ seatsTotal: 2 });
    expect(result.success).toBe(true);
  });

  it("accepts partial update with price and comment", () => {
    const result = updateTripDtoSchema.safeParse({
      price: 800,
      comment: "Один раз остановлюсь",
    });
    expect(result.success).toBe(true);
  });

  // РЕШЕНИЕ ВЛАДЕЛЬЦА 2026-10-08: маршрут заморожен, а флаги опций
  // (`autoComplete`/`matchingEnabled`) в PATCH РЕДАКТИРУЕМЫ — водитель вправе
  // передумать после публикации. Засвидетельствовано здесь, чтобы решение
  // не выглядело молчаливым: если поля однажды уедут в .omit(), эти тесты
  // упадут.
  it("accepts flipping both option flags (водитель передумал после публикации)", () => {
    const turnOn = updateTripDtoSchema.safeParse({
      autoComplete: true,
      matchingEnabled: true,
    });
    expect(turnOn.success).toBe(true);

    const turnOff = updateTripDtoSchema.safeParse({
      autoComplete: false,
      matchingEnabled: false,
    });
    expect(turnOff.success).toBe(true);
    if (turnOff.success) {
      // Явный false = «выключить», а не «не передано».
      expect(turnOff.data.autoComplete).toBe(false);
      expect(turnOff.data.matchingEnabled).toBe(false);
    }
  });

  it("keeps flags optional in PATCH (отсутствие ключа = «не менять»)", () => {
    const result = updateTripDtoSchema.safeParse({ price: 900 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoComplete).toBeUndefined();
      expect(result.data.matchingEnabled).toBeUndefined();
    }
  });

  // Регрессия (zod 4): если бы флаги лежали в baseTripSchema с .default(),
  // то .partial() обернул бы их в ZodOptional, который СОХРАНЯЕТ rung
  // «defaulted» ($ZodOptional/optin), и PATCH без этих ключей подставил бы
  // дефолты. Водитель, поменявший цену, молча потерял бы выбор флагов.
  // Дефолты поэтому живут только в createTripDtoSchema.
  it("does not substitute flag defaults in PATCH (дефолты только в create)", () => {
    const result = updateTripDtoSchema.safeParse({ price: 900 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect("autoComplete" in result.data).toBe(false);
      expect("matchingEnabled" in result.data).toBe(false);
    }
  });

  it("treats explicit false as «выключить», а не как «не передано»", () => {
    const result = updateTripDtoSchema.safeParse({ matchingEnabled: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.matchingEnabled).toBe(false);
    }
  });

  it("rejects non-boolean option flags in PATCH", () => {
    expect(updateTripDtoSchema.safeParse({ autoComplete: "yes" }).success).toBe(false);
    expect(updateTripDtoSchema.safeParse({ matchingEnabled: 1 }).success).toBe(false);
  });

  it("rejects update that tries to change fromCity (route is locked)", () => {
    const result = updateTripDtoSchema.safeParse({
      fromCity: "Санкт-Петербург",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // Zod 4: unrecognized_keys группирует все лишние поля в один
      // issue с пустым path. Проверяем упоминание поля в messages.
      const messages = result.error.issues.map((i) => i.message).join("|");
      expect(messages).toMatch(/fromCity/);
    }
  });

  it("rejects update that tries to change toCity (route is locked)", () => {
    const result = updateTripDtoSchema.safeParse({
      toCity: "Вологда",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join("|");
      expect(messages).toMatch(/toCity/);
    }
  });

  it("rejects update that tries to change fromCityId (route is locked)", () => {
    const result = updateTripDtoSchema.safeParse({
      fromCityId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join("|");
      expect(messages).toMatch(/fromCityId/);
    }
  });

  it("rejects update that tries to change toCityId (route is locked)", () => {
    const result = updateTripDtoSchema.safeParse({
      toCityId: "22222222-2222-4222-8222-222222222222",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join("|");
      expect(messages).toMatch(/toCityId/);
    }
  });

  it("rejects update that tries to change address and route in one shot", () => {
    const result = updateTripDtoSchema.safeParse({
      fromAddress: "Новый адрес",
      fromCityId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });

  it("still validates durationMinutes / price / seatsTotal bounds", () => {
    const tooExpensive = updateTripDtoSchema.safeParse({ price: 200000 });
    expect(tooExpensive.success).toBe(false);

    const zeroDuration = updateTripDtoSchema.safeParse({ durationMinutes: 0 });
    expect(zeroDuration.success).toBe(false);

    const tooManySeats = updateTripDtoSchema.safeParse({ seatsTotal: 5 });
    expect(tooManySeats.success).toBe(false);
  });
});
