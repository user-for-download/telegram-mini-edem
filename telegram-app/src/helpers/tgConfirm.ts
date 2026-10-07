// telegram-app/src/helpers/tgConfirm.ts
// Подтверждение действия перед созданием заявки: три уровня, выигрывает
// первый доступный.
//
// Уровень 1 — `showConfirm` объекта WebApp клиента. Метод НЕ входит в
// стандартный Telegram WebApp API, а в установленном @tma.js/sdk@3.0.23
// нет feature `popup` (`web_app_open_popup`) — нативного диалога с нужными
// подписями кнопок без бампа SDK не будет (решение Д2: кастомные подписи
// «Показать»/«Создать заявку» отложены, ради них версию не поднимаем).
// Поэтому уровень ищет метод на месте, без импорта SDK: прямая зависимость
// от SDK в хелпере утащила бы bridge в юнит-тест и требовала бы апгрейда
// ради возможности, которой в этой версии нет.
//
// Уровень 2 — `window.confirm`, и это ОСНОВНОЙ механизм, а не аварийный:
// он есть в браузере и в Telegram WebView, и именно его ждёт пользователь.
// Подписи кнопок стандартные — это осознанный размен на «не бампаем SDK».
//
// Уровень 3 — `false`, то есть «согласия нет». ВАЖНО: не `true`.
// В jsdom `window.confirm` не реализован (возвращает undefined, а часть
// окружений бросает «Not implemented»), и «не спросили» здесь НЕ значит
// «согласие»: вызывающий трактует согласие как уход в карточку поездки
// вместо публикации заявки, и трактовка «нет ответа» как «да» молча
// перехватывала бы единственное нажатие «Создать заявку» в окружении без
// диалогов (jsdom, часть WebView). Принцип: действие по умолчанию не
// блокируется и не подменяется — не спросили, значит делаем ровно то, что
// человек и так собирался сделать.

type ShowConfirm = (message: string) => unknown;

/**
 * `showConfirm` клиента, если он вообще есть, иначе null — уровень выбывает.
 *
 * Проба идёт по наличию функции на объекте WebApp, а не по версии SDK:
 * метод нестандартный, поэтому проверять надо фактическую поверхность, а не
 * типы пакета. `this` привязываем явно — метод клиента может звать себя.
 */
function findShowConfirm(): ShowConfirm | null {
  try {
    // Проба через globalThis, а не `window`: вне браузера (SSR-рендер тестов)
    // обращение к `window` само по себе ReferenceError. Двойное утверждение
    // — как в init.ts, где так же читается нестандартный WebApp-клиент.
    const webApp = (
      globalThis as unknown as {
        Telegram?: { WebApp?: { showConfirm?: ShowConfirm } };
      }
    ).Telegram?.WebApp;
    if (!webApp) return null;
    const showConfirm = webApp.showConfirm;
    if (typeof showConfirm !== "function") return null;
    return showConfirm.bind(webApp);
  } catch {
    // Геттер на клиентском объекте может бросить — уровень выбывает молча.
    return null;
  }
}

/**
 * Спросить подтверждение у пользователя.
 *
 * `true` — только реальный ответ «согласился», `false` — всё остальное:
 * отказ, а также ситуации «спросить нечем». Различать их нельзя: и то и
 * другое означает «уводить пользователя из его намерения нельзя».
 */
export async function tgConfirm(message: string): Promise<boolean> {
  const showConfirm = findShowConfirm();
  if (showConfirm !== null) {
    try {
      const answer = showConfirm(message);
      if (typeof answer === "boolean") return answer;
    } catch {
      // Клиентский метод не сработал — считаем, что не спросили.
    }
    // Не-boolean/исключение у диалога клиента: второй диалог не показываем —
    // сломанный нативный метод в 2 раза хуже одного окна браузера, а ответ
    // «спросить не удалось» здесь тот же, что и без подтверждения вовсе.
    return false;
  }

  try {
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      const answer = window.confirm(message);
      if (typeof answer === "boolean") return answer;
    }
  } catch {
    // window.confirm бывает не реализован (jsdom, часть WebView) — не падаем.
  }
  return false;
}
