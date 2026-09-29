// Популярные направления главной (Вологодская область — как справочник
// городов в backend/prisma/cities-data.ts). Клик — пресет для поиска.
export interface PopularRoute {
  from: string;
  to: string;
}
// TODO: пока для теста так. Потом будем вычислять на сервере разв 30 дней
export const POPULAR_ROUTES: readonly PopularRoute[] = [
  { from: "Вологда", to: "Череповец" },
  { from: "Вологда", to: "Сокол" },
  { from: "Вологда", to: "Великий Устюг" },
  { from: "Вологда", to: "Кириллов" },
  { from: "Вологда", to: "Тотьма" },
  { from: "Череповец", to: "Белозерск" },
];
