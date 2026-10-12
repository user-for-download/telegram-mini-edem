import { useId } from "react";
import {
  Caption,
  Modal,
  Placeholder,
  Text,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import type { Report } from "@edem/contracts";

import { OfflineBanner } from "@/components/OfflineBanner";
import { Stack } from "@/ui/Stack";
import { Notice } from "@/ui/Notice";
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
 * Хост-managed (`report` + `onClose`): кит ведёт себя по `open`, Back
 * перехватывает `useModalBack` страницы. `report === null` = «окно закрыто».
 *
 * Тело — `Placeholder` БЕЗ картинки: жалоба это короткий текст со статусом,
 * а не иллюстрация, и заглушка-картинка читалась бы как «данных нет».
 * Раньше здесь была своя вёрстка (шапка, пилюля, Notice) — она выглядела
 * тяжелее самой сути: текста жалобы и ответа модерации.
 *
 * Имя диалога — скрытый h2 на `aria-labelledby` (приём из `ui/Sheet`):
 * видимый заголовок рисует только `Modal.Header` на iOS, на base его нет,
 * и без скрытого имени модалка осталась бы безымянной для скринридера.
 *
 * `OfflineBanner` обязателен: портал перекрывает глобальный баннер из
 * AppConfig, на страницах копии не дублируются (см. ComplaintModal).
 */
export function ReportDetailsModal({
  report,
  onClose,
}: {
  report: Report | null;
  onClose: () => void;
}) {
  const titleId = useId();
  return (
    <Modal
      open={report !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={
        <Modal.Header>
          <span aria-hidden="true">Жалоба</span>
        </Modal.Header>
      }
      aria-labelledby={titleId}
    >
      <VisuallyHidden Component="h2" id={titleId}>
        Жалоба
      </VisuallyHidden>
      <OfflineBanner />
      {report === null ? null : <ReportDetailsBody report={report} />}
    </Modal>
  );
}

/**
 * Тело попапа без обёртки Modal — экспортируется ради SSR-тестов: Modal кита
 * это портал, в renderToString он не попадает (приём взят у
 * `TripRequestsBody`).
 */
export function ReportDetailsBody({ report }: { report: Report }) {
  return (
    <Placeholder
      header={`${REPORT_CATEGORY_LABELS[report.category]} · ${REPORT_TARGET_TYPE_LABELS[report.targetType]}`}
      description={
        <Stack className={styles.details}>
          <Caption className={styles.detailsDate}>
            {moscowNumericDate(report.createdAt)}
          </Caption>
          <Text className={styles.detailsText}>{report.description}</Text>
          {/* Статус тем же тоном, что строка в ленте: «рассмотрена» читается
              одинаково в обоих местах. Пилюли здесь нет — Placeholder сам
              работает крупными блоками, пилюля в нём выглядела бы вставкой. */}
          <Caption
            data-tone={reportStatusTone(report.status)}
            className={styles.detailsStatus}
          >
            {REPORT_STATUS_LABELS[report.status]}
          </Caption>
          {/* Ответ модерации — только он различает «рассмотрена» и
              «отклонена» по сути, поэтому отдельным блоком. */}
          {report.resolutionNote ? (
            <Notice
              tone={report.status === "resolved" ? "success" : "info"}
            >
              <strong>Ответ модерации</strong>
              {report.resolutionNote}
            </Notice>
          ) : null}
        </Stack>
      }
    />
  );
}
