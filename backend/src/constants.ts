/**
 * Дефолтный плейсхолдер «нет фото»: inline SVG (data-URI), без внешних CDN.
 * Внешняя картинка здесь недопустима: каждый фолбэк-аватар тянул бы запрос
 * к чужому хосту и ронял бы аватары при его недоступности.
 * `img-src` в CSP разрешает `data:` (см. app.ts).
 * Используется для всех пользователей без реального аватара.
 */
export const DEFAULT_AVATAR_URL =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'%3E%3Crect width='200' height='200' fill='%23E5E7EB'/%3E%3Ccircle cx='100' cy='75' r='38' fill='%239CA3AF'/%3E%3Cpath d='M30 185c8-40 36-60 70-60s62 20 70 60z' fill='%239CA3AF'/%3E%3C/svg%3E";
