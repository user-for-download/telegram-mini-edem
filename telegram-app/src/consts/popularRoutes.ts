// Популярные направления главной (Вологодская область — как справочник
// городов в backend/prisma/cities-data.ts). Клик — пресет для поиска.
export interface PopularRoute {
  icon: string;
  from: string;
  to: string;
}

export const POPULAR_ROUTES: readonly PopularRoute[] = [
  { icon: "🏭", from: "Вологда", to: "Череповец" },
  { icon: "🌲", from: "Вологда", to: "Сокол" },
  { icon: "⛄", from: "Вологда", to: "Великий Устюг" },
  { icon: "⛪", from: "Вологда", to: "Кириллов" },
  { icon: "🧭", from: "Вологда", to: "Тотьма" },
  { icon: "🚤", from: "Череповец", to: "Белозерск" },
];
