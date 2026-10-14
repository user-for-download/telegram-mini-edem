import { useState } from "react";
import { Caption, Subheadline } from "@telegram-apps/telegram-ui";
import type { Report } from "@edem/contracts";

import { OfflineBanner } from "@/components/OfflineBanner";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { Sheet } from "@/ui/Sheet";
import { Stack } from "@/ui/Stack";
import { Blockquote } from "@/ui/Blockquote";
import { moscowNumericDate } from "@/utils/date";

import { REPORT_STATUS_LABELS } from "./reportValidation";
import {
  reportPreviewTitle,
  reportResponseMeta,
  reportStatusTone,
} from "./reportPreview";
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
 * Раскладка — сверху вниз по смыслу: ЧТО за жалоба (категория · тип, тем же
 * форматтером, что строка ленты) и её состояние пилюлей → когда подана →
 * САМА ЖАЛОБА в плашке → ответ модерации вместе со временем ожидания.
 *
 * Раньше тело было `Placeholder` (компонент ПУСТОГО состояния), и служебные
 * строки шли четырьмя равновесными подряд: статус терялся среди даты, а
 * «Ответ 10.09.2026 · через 3 ч» стоял ВЫШЕ текста жалобы — читатель узнавал,
 * когда пришёл ответ, прежде чем прочитать, на что жалуются. Теперь два
 * уровня: шапка (предмет + статус-пилюля, дата справкой) и содержимое, а факт
 * ответа приклеен к его тексту, а не висит отдельной строкой.
 */
export function ReportDetailsBody({ report }: { report: Report }) {
  const response = reportResponseMeta(report);
  const note = report.resolutionNote;
  return (
    <Stack>
      {/* Предмет жалобы и её состояние одной строкой: статус — главный
          признак, ради которого открывают попап, и он читается одинаково со
          списком заявок и карточками (StatusPill). */}
      <div className={styles.detailsHead}>
        <Subheadline weight="2" className={styles.detailsSubject}>
          {reportPreviewTitle(report)}
        </Subheadline>
        <StatusPill tone={reportStatusTone(report.status)}>
          {REPORT_STATUS_LABELS[report.status]}
        </StatusPill>
      </div>
      <Caption className={styles.detailsDate}>
        {`Подана ${moscowNumericDate(report.createdAt)}`}
      </Caption>
      {/* Текст жалобы — слова автора, поэтому плашка-цитата: она и отделяет
          его от служебных строк, и хранит переносы, набранные человеком. */}
      <Blockquote>{report.description}</Blockquote>
      {/* Ответ модерации — у закрытых жалоб. Ключ — мета времени ИЛИ текст:
          бэкенд ставит `resolvedAt` и заметку вместе, но в контракте они
          независимы, и заметка без даты не должна пропадать. Подпись несёт и
          время ожидания, и стоит там же, где сам ответ: «когда ответили» без
          ответа отдельно не читается. */}
      {response || note ? (
        <>
          <Caption className={styles.detailsLabel}>
            {response ? `Ответ модерации · ${response}` : "Ответ модерации"}
          </Caption>
          {/* Текст может отсутствовать (модератор закрыл без заметки) — тогда
              строка времени остаётся одна, без пустой плашки. */}
          {note ? (
            <Blockquote
              tone={report.status === "resolved" ? "success" : "warning"}
            >
              {note}
            </Blockquote>
          ) : null}
        </>
      ) : null}
    </Stack>
  );
}
