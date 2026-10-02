/**
 * Чистая валидация/нормализация формы профиля (порт EditProfileModal).
 * Отдельный DOM-free модуль, чтобы покрыть unit-тестом без
 * jsdom: страница импортирует, тесты проверяют напрямую.
 */

/**
 * Ошибка формы профиля с привязкой к полю.
 *
 * Раньше валидатор возвращал `string | null`, и любой потребитель обязан был
 * сам решать, к какому полю отнести текст. Из-за этого ошибка попадала в
 * общий `Notice role="alert"` под формой, а само поле оставалось без
 * `aria-invalid` и без `aria-describedby`: 0 из 54 полей приложения это
 * делали (замер 2026-10-02). Здесь ошибка приходит с полем — потребитель
 * передаёт её в `<Field error=…>`, и фасад ставит разметку сам.
 */
export interface ProfileFieldError {
  /** id поля формы (`profile-name` / `profile-about` / `profile-phone`). */
  field: string;
  message: string;
}

/**
 * Проверки формы профиля по полям. Порядок и тексты — как были в
 * `validateProfileForm`, чтобы его вызов остался совместимым.
 */
export function validateProfileFields(
  name: string,
  about: string,
  phone = "",
): ProfileFieldError | null {
  const trimmedName = name.trim();
  if (trimmedName.length < 2) {
    return {
      field: "profile-name",
      message: "Имя должно содержать минимум 2 символа",
    };
  }
  if (trimmedName.length > 100) {
    return {
      field: "profile-name",
      message: "Имя не может быть длиннее 100 символов",
    };
  }
  if (about.trim().length > 500) {
    return {
      field: "profile-about",
      message: "Поле «О себе» не может быть длиннее 500 символов",
    };
  }
  const trimmedPhone = phone.trim();
  if (
    trimmedPhone &&
    !/^\+?\d{7,15}$/.test(trimmedPhone.replace(/[\s\-()]/g, ""))
  ) {
    return {
      field: "profile-phone",
      message: "Телефон: 7–15 цифр, можно с + в начале",
    };
  }
  return null;
}

/**
 * Нормализация перед PATCH /users/me: пустое «О себе» отправляем явным
 * null (бэкенд: undefined = оставить прежнее, null = очистить; схема
 * nullable().optional()). Омиссия поля не давала стереть описание.
 * Телефон: пустой → null (очистка), иначе как есть (бэкенд нормализует).
 */
export function normalizeProfileForm(
  name: string,
  about: string,
  phone = "",
): { name: string; about: string | null; phone: string | null } {
  const trimmedAbout = about.trim();
  const trimmedPhone = phone.trim();
  return {
    name: name.trim(),
    about: trimmedAbout || null,
    phone: trimmedPhone || null,
  };
}
