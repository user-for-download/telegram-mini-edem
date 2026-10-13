import { useState } from "react";
import { Caption, Subheadline } from "@telegram-apps/telegram-ui";
import type { Report } from "@edem/contracts";

import { OfflineBanner } from "@/components/OfflineBanner";
import { Sheet } from "@/ui/Sheet";
import { Stack } from "@/ui/Stack";
import { Blockquote } from "@/ui/Blockquote";
import { moscowNumericDate } from "@/utils/date";

import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
} from "./reportValidation";
import { reportStatusTone } from "./reportPreview";
import styles from "./ReportsPage.module.css";

/**
 * Попап с подробностями жалобы — по тапу на строку списка.
 *
 * Хост-managed (`report` + `onClose`): Back перехватывает `useModalBack`
 * страницы. `report === null` = «окно закрыто».
 *
 * Контейнер — `ui/Sheet`, как у всех остальных модалок приложения (включая
 * соседнюю `ComplaintModal` на этом же экране). Раньше здесь был сырой
 * `Modal` кита, и это стоило трёх вещей, которые даёт фасад: видимого
 * заголовка на base (китовый `Modal.Header` рисует текст ТОЛЬКО на iOS, на
 * Android и десктопе карточка жалобы открывалась вообще без названия),
 * перевода фокуса на тело при открытии (точка входа для клавиатуры и
 * скринридера) и всей обвязки имени диалога. Переезд случился не по
 * продуктовому решению «это не шторка», а заодно с переписыванием тела:
 * исходная претензия была к вёрстке («четыре конкурирующих блока»), и её
 * закрыли плашками-цитатами, а контейнер остался мимо фасада.
 *
 * `retained` (ниже) при этом НЕ мешает фасаду: кит кладёт тело в
 * `Drawer.Content`, а Radix `Presence` держит его смонтированным до конца
 * exit-анимации (`mounted → unmountSuspended → unmounted`), поэтому окно
 * закрывается поверх прежнего содержимого. Без удержания тело исчезало бы
 * в тот же кадр, когда `report` стал null, — шторка уезжала бы пустой.
 *
 * `OfflineBanner` обязателен: портал перекрывает глобальный баннер из
 * AppConfig, на страницах копии не дублируются (см. ComplaintModal).
 * Первым ребёнком — как там же.
 */
export function ReportDetailsModal({
  report,
  onClose,
}: {
  report: Report | null;
  onClose: () => void;
}) {
  // Последний report живёт до размонтирования тела: при закрытии report
  // становится null, а шторка ещё играет exit-анимацию — тело, зануленное
  // вместе с report, мигнуло бы пустотой. Удержание даёт окну закрыться
  // поверх прежнего содержимого.
  //
  // СОСТОЯНИЕ, а не ref: чтение ref во время рендера запрещено правилом
  // react-hooks/refs (такой вариант ловил линт). Обновление состояния на
  // рендере разрешено React для собственного состояния компонента при
  // изменении props; сравнение по идентичности исключает цикл рендеров.
  const [retained, setRetained] = useState(report);
  if (report !== null && report !== retained) setRetained(report);
  const visible = report ?? retained;
  return (
    <Sheet open={report !== null} onClose={onClose} title="Жалоба">
      <OfflineBanner />
      {visible === null ? null : <ReportDetailsBody report={visible} />}
    </Sheet>
  );
}

/**
 * Тело попапа без обёртки Sheet — экспортируется ради SSR-тестов: Modal кита
 * это портал, в renderToString он не попадает (приём взят у
 * `TripRequestsBody`).
 *
 * Раньше тело было `Placeholder` — компонентом ПУСТОГО состояния: он
 * центрирует содержимое и набирает заголовок крупным кеглем. Для карточки с
 * жалобой это читалось как «данных нет», и весь попап выходил сплошняком —
 * четыре блока одного веса без границ. Теперь это обычная колонка: что
 * (категория · тип) → когда → чем кончилось → САМА ЖАЛОБА → ответ модерации,
 * причём два свободных текста стоят в плашках `ui/Blockquote` — с полосой,
 * фоном и переносами строк.
 */
export function ReportDetailsBody({ report }: { report: Report }) {
  return (
    <Stack className={styles.details}>
      <Subheadline weight="2">
        {`${REPORT_CATEGORY_LABELS[report.category]} · ${REPORT_TARGET_TYPE_LABELS[report.targetType]}`}
      </Subheadline>
      <Caption className={styles.detailsDate}>
        {moscowNumericDate(report.createdAt)}
      </Caption>
      {/* Статус тем же тоном, что строка в ленте: «рассмотрена» читается
          одинаково в обоих местах. */}
      <Caption
        data-tone={reportStatusTone(report.status)}
        className={styles.detailsStatus}
      >
        {REPORT_STATUS_LABELS[report.status]}
      </Caption>
      {/* Текст жалобы — слова автора, поэтому плашка-цитата: она и отделяет
          его от служебных строк, и хранит переносы, набранные человеком. */}
      <Blockquote>{report.description}</Blockquote>
      {/* Ответ модерации — тоже чужие слова, отдельная плашка со своим тоном:
          «отклонена» и «нарушений не найдено» — разный исход, и полоса слева
          это показывает. */}
      {report.resolutionNote ? (
        <>
          <Caption className={styles.detailsLabel}>Ответ модерации</Caption>
          <Blockquote
            tone={report.status === "resolved" ? "success" : "warning"}
          >
            {report.resolutionNote}
          </Blockquote>
        </>
      ) : null}
    </Stack>
  );
}
