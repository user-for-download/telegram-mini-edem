// Тесты U4: единый словарь пустых состояний — канон 1:1.
// Лочат формулировки (смена вне скоупа) и стабильность ключей:
// экраны берут тексты отсюда через QueryState/EmptyState, литералы
// в экранах запрещены.
import { describe, expect, it } from "vitest";

import { EMPTY_STATES, type EmptyStateKey } from "@/ui/emptyStates";

describe("EMPTY_STATES: словарь зафиксирован 1:1", () => {
  it("все записи — непустой header строкой", () => {
    for (const [key, entry] of Object.entries(EMPTY_STATES)) {
      expect(typeof entry.header, key).toBe("string");
      expect(entry.header.length, key).toBeGreaterThan(0);
      if ("description" in entry) {
        expect(typeof entry.description, key).toBe("string");
        expect(entry.description!.length, key).toBeGreaterThan(0);
      }
    }
  });

  it("ключи стабильны (экраны ссылаются на них)", () => {
    const keys = Object.keys(EMPTY_STATES).sort();
    expect(keys).toEqual(
      [
        "genericEmpty",
        "loadError",
        "notificationsEmpty",
        "profileEmpty",
        "profileReviewsEmpty",
        "reportsEmpty",
        "reviewsAboutEmpty",
        "reviewsMineEmpty",
        "reviewsNewEmpty",
        "rideRequestsEmpty",
        "searchNoResults",
        "settingsEmpty",
        "supportEmpty",
        "tripActive",
        "tripCancelled",
        "tripCompleted",
        "tripDeparted",
        "tripHistory",
        "tripNoSeats",
        "tripNotFound",
        "tripNotFoundDeleted",
        "tripNotFoundHint",
        "tripRequestsEmpty",
        "vehicleEmpty",
      ].sort(),
    );
  });

  it("канон QueryState: «Пока пусто» + ошибка загрузки", () => {
    expect(EMPTY_STATES.genericEmpty.header).toBe("Пока пусто");
    expect(EMPTY_STATES.loadError.header).toBe(
      "Не удалось загрузить данные",
    );
    expect(EMPTY_STATES.loadError.description).toBe(
      "Проверьте соединение и повторите попытку.",
    );
  });

  it("канон ленты: активные, история, поиск", () => {
    expect(EMPTY_STATES.tripActive.description).toBe(
      "Пока тихо: забронируйте поездку или опубликуйте свой маршрут!",
    );
    expect(EMPTY_STATES.tripHistory.description).toBe(
      "Здесь появятся завершённые и отменённые поездки.",
    );
    expect(EMPTY_STATES.searchNoResults.header).toBe("Поездок не найдено");
    expect(EMPTY_STATES.searchNoResults.description).toBe(
      "Попробуйте изменить города или выбрать другие даты отправления",
    );
  });

  it("канон деталей поездки", () => {
    expect(EMPTY_STATES.tripNotFound.header).toBe("Поездка не найдена");
    expect(EMPTY_STATES.tripNotFoundDeleted.description).toBe(
      "Возможно, поездка была удалена или ссылка устарела.",
    );
    expect(EMPTY_STATES.tripNotFoundHint.description).toBe(
      "Вернитесь к поиску и выберите другую поездку.",
    );
    expect(EMPTY_STATES.tripNoSeats.header).toBe("Свободных мест нет");
    expect(EMPTY_STATES.tripNoSeats.description).toBe(
      "Попробуйте другую поездку или оставьте запрос попутчика.",
    );
    expect(EMPTY_STATES.tripDeparted.header).toBe("Поездка уже отправилась");
    expect(EMPTY_STATES.tripDeparted.description).toBe(
      "Бронирование недоступно. Найдите другую поездку.",
    );
    expect(EMPTY_STATES.tripCancelled.header).toBe("Поездка отменена");
    expect(EMPTY_STATES.tripCompleted.header).toBe("Поездка завершена");
  });

  it("канон заявок, жалоб, отзывов, уведомлений, поддержки", () => {
    expect(EMPTY_STATES.tripRequestsEmpty.header).toBe("Заявок нет");
    expect(EMPTY_STATES.rideRequestsEmpty.description).toBe(
      "Активных запросов нет.",
    );
    expect(EMPTY_STATES.reportsEmpty.header).toBe(
      "Вы пока не отправляли жалоб",
    );
    expect(EMPTY_STATES.reportsEmpty.description).toBe(
      "Жалобы на поездки доступны пассажирам с бронью. На свою поездку жаловаться нельзя.",
    );
    expect(EMPTY_STATES.reviewsMineEmpty.header).toBe(
      "Вы пока не оставили отзывов",
    );
    expect(EMPTY_STATES.reviewsMineEmpty.description).toBe(
      "Оставьте отзыв о поездке — это поможет другим выбрать маршрут",
    );
    expect(EMPTY_STATES.reviewsNewEmpty.header).toBe(
      "Пока нет поездок для отзыва",
    );
    expect(EMPTY_STATES.reviewsNewEmpty.description).toBe(
      "Когда вы совершите поездку, она появится здесь",
    );
    expect(EMPTY_STATES.reviewsAboutEmpty.header).toBe(
      "О вас пока нет отзывов",
    );
    // ReviewsModal — без точки; ProfilePage — с точкой: разные записи 1:1.
    expect(EMPTY_STATES.reviewsAboutEmpty.description).toBe(
      "После поездок пассажиры и водители смогут оценить вас — отзывы появятся здесь",
    );
    expect(EMPTY_STATES.profileReviewsEmpty.description).toBe(
      "После поездок пассажиры и водители смогут оценить вас — отзывы появятся здесь.",
    );
    expect(EMPTY_STATES.notificationsEmpty.header).toBe(
      "Пока нет уведомлений",
    );
    expect(EMPTY_STATES.notificationsEmpty.description).toBe(
      "Подтверждения брони, отмены и завершение поездок появятся здесь",
    );
    expect(EMPTY_STATES.supportEmpty.header).toBe(
      "У вас пока нет обращений",
    );
    expect(EMPTY_STATES.supportEmpty.description).toBe(
      "Здесь появятся ваши обращения и ответы поддержки",
    );
  });

  it("канон незагруженных сущностей (QueryState emptyText)", () => {
    expect(EMPTY_STATES.profileEmpty.description).toBe(
      "Не удалось загрузить профиль.",
    );
    expect(EMPTY_STATES.settingsEmpty.description).toBe(
      "Не удалось загрузить настройки.",
    );
    expect(EMPTY_STATES.vehicleEmpty.description).toBe(
      "Не удалось загрузить автомобиль.",
    );
  });

  it("тип ключа покрывает все записи", () => {
    const key: EmptyStateKey = "tripActive";
    expect(EMPTY_STATES[key].header).toBe("Пока пусто");
  });
});
