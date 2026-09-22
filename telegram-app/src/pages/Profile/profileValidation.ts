/**
 * Чистая валидация/нормализация формы профиля (порт EditProfileModal из
 * mini-app). Отдельный DOM-free модуль, чтобы покрыть unit-тестом без
 * jsdom: страница импортирует, тесты проверяют напрямую.
 */
export function validateProfileForm(name: string, about: string): string | null {
  const trimmedName = name.trim();
  if (trimmedName.length < 2) {
    return "Имя должно содержать минимум 2 символа";
  }
  if (trimmedName.length > 100) {
    return "Имя не может быть длиннее 100 символов";
  }
  if (about.trim().length > 500) {
    return "Поле «О себе» не может быть длиннее 500 символов";
  }
  return null;
}

/**
 * Нормализация перед PATCH /users/me: пустое «О себе» отправляем явным
 * null (бэкенд: undefined = оставить прежнее, null = очистить; схема
 * nullable().optional()). Омиссия поля не давала стереть описание.
 */
export function normalizeProfileForm(
  name: string,
  about: string,
): { name: string; about: string | null } {
  const trimmedAbout = about.trim();
  return {
    name: name.trim(),
    about: trimmedAbout || null,
  };
}
