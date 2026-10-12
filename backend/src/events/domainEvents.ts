// backend/src/events/domainEvents.ts
//
// Типизированные доменные события бэкенда (observer без Hono).
//
// ЗАЧЕМ. Уведомления и побочные эффекты раньше писались руками в каждой
// точке мутации (16 вызовов notifyUser + тексты type/title/body/fragment
// в роутах). Точка знает, ЧТО случилось (факты, которые уже держит),
// подписчик — ЧТО с этим делать (форматирование + notifyUser).
//
// ПОЧЕМУ НЕ @hono/event-emitter. Официальный middleware требует Hono
// Context в каждом хендлере `(c, payload)`, а события исходят из воркеров
// (tripWorker) и фоновых вызовов, где контекста запроса нет. Таскать
// контекст ради подписи — трение без выгоды; пакет при этом вялый
// (v2.0.0, релиз ~1–2 года назад). Здесь — ~50 строк по образцу
// MiniEmitter фронта (telegram-app/src/api/emitter.ts): карта
// «событие → payload», без Context, с изоляцией ошибок.
//
// КОНТРАКТЫ НАДЁЖНОСТИ (не нарушать):
// - emit() никогда не бросает: ошибка слушателя логируется, остальные
//   слушатели всё равно вызываются. Вызывающий `await`ит как раньше
//   `await notifyUser` — порядок и латентность запроса не меняются.
// - emit() — только ПОСЛЕ успешного коммита мутации, никогда внутри
//   транзакции и до неё: слушатель не должен видеть незакоммиченные
//   данные и не должен откатывать основную операцию.
// - Шина внутрипроцессная: для межпроцессной доставки уже есть outbox
//   (NotificationDelivery + диспетчер), эмиттер её не заменяет.
import { logger } from "../logger.js";

/** Факты поездки, уже загруженные вызывающим (доп. запросов нет). */
export interface TripFacts {
  fromCity: string;
  toCity: string;
  price: number;
  departureAt: Date;
}

/**
 * Карта «событие → payload». Новое событие = новая строка + подписчик.
 * Payload — только факты (id, имена, уже загруженные объекты), никакого
 * оформительского текста: строки type/title/body живут в подписчике.
 *
 * Именно `type`, а не `interface`: алиас получает неявную индекс-сигнатуру
 * и удовлетворяет ограничению `Record<string, unknown>` дженерика ниже,
 * а interface — нет (известная особенность TS).
 */
export type DomainEvents = {
  /** Пассажир создал заявку: уведомить водителя. */
  "booking.created": {
    bookingId: string;
    tripId: string;
    seat: number;
    driverId: string;
    passengerName: string;
    trip: TripFacts;
  };
  /** Водитель сменил статус заявки: уведомить пассажира. */
  "booking.status_changed": {
    bookingId: string;
    tripId: string;
    oldStatus: string;
    newStatus: string;
    passengerId: string;
    driverName: string;
    trip: TripFacts;
  };
  /** Водитель отменил поездку: уведомить подтверждённых пассажиров. */
  "trip.cancelled": {
    tripId: string;
    driverName: string;
    passengerIds: string[];
    trip: TripFacts;
  };
};

type Listener<Payload> = (payload: Payload) => void | Promise<void>;

/**
 * Мини-эмиттер вида on/emit. Ошибка одного слушателя изолируется
 * (остальные вызываются) и уходит в лог; emit резолвится, когда осели
 * все слушатели, и не реджектится никогда.
 */
export class DomainEmitter<Events extends Record<string, unknown>> {
  private readonly sets = new Map<
    keyof Events,
    Set<(payload: never) => unknown>
  >();

  constructor(private readonly label = "domain") {}

  on<E extends keyof Events>(
    event: E,
    listener: Listener<Events[E]>,
  ): () => void {
    let set = this.sets.get(event);
    if (!set) {
      set = new Set();
      this.sets.set(event, set);
    }
    set.add(listener as (payload: never) => unknown);
    return () => {
      this.off(event, listener);
    };
  }

  off<E extends keyof Events>(event: E, listener: Listener<Events[E]>): void {
    this.sets.get(event)?.delete(listener as (payload: never) => unknown);
  }

  /** Количество подписчиков (для тестов и диагностики). */
  listenerCount<E extends keyof Events>(event: E): number {
    return this.sets.get(event)?.size ?? 0;
  }

  async emit<E extends keyof Events>(
    event: E,
    payload: Events[E],
  ): Promise<void> {
    const set = this.sets.get(event);
    if (!set || set.size === 0) return;
    await Promise.all(
      [...set].map(async (listener) => {
        try {
          await (listener as Listener<Events[E]>)(payload);
        } catch (err) {
          logger.error(
            { err, event: String(event) },
            `[${this.label}] listener failed`,
          );
        }
      }),
    );
  }
}

/** Синглтон шины. Подписчики регистрируются один раз (app.ts). */
export const domainEvents = new DomainEmitter<DomainEvents>("domain");
