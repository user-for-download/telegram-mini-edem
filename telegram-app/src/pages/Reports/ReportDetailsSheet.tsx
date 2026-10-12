import { Caption, Text } from "@telegram-apps/telegram-ui";
import type { Report } from "@edem/contracts";

import { OfflineBanner } from "@/components/OfflineBanner";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { Sheet } from "@/ui/Sheet";
import { PROSE } from "@/ui/classes";
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
 * В списке жалоба сжата до трёх строк (как уведомление), поэтому полный текст
 * жалобы и ответ модерации уехали сюда: в ленте они раздавливали строки, а
 * читать их всё равно нужно целиком.
 *
 * Хост-managed (`report` + `onClose`), тот же приём, что у ComplaintModal на
 * этой же странице: Back перехватывает `useModalBack` у страницы, фон — сама
 * страница со списком. `report === null` означает «окно закрыто»: тело не
 * рендерим вовсе, чтобы кит не держал разметку закрытой шторки.
 *
 * `OfflineBanner` обязателен: портал шторки перекрывает глобальный баннер из
 * AppConfig, а на страницах локальные копии не дублируются (см. ComplaintModal).
 */
export function ReportDetailsSheet({
  report,
  onClose,
}: {
  report: Report | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={report !== null} onClose={onClose} title="Жалоба">
      <OfflineBanner />
      {report === null ? null : <ReportDetailsBody report={report} />}
    </Sheet>
  );
}

/**
 * Тело попапа без обёртки Sheet — экспортируется ради SSR-тестов: Modal
 * китa это портал, в renderToString он не попадает (тот же приём, что у
 * `TripRequestsBody`).
 */
export function ReportDetailsBody({ report }: { report: Report }) {
  return (
    <Stack>
      <div className={styles.head}>
        <div className={styles.headText}>
          <Text weight="2" Component="div">
            {`${REPORT_CATEGORY_LABELS[report.category]} · ${REPORT_TARGET_TYPE_LABELS[report.targetType]}`}
          </Text>
          <Caption Component="div">{moscowNumericDate(report.createdAt)}</Caption>
        </div>
        <StatusPill tone={reportStatusTone(report.status)}>
          {REPORT_STATUS_LABELS[report.status]}
        </StatusPill>
      </div>
      {/* Полный текст жалобы: в списке он обрезан одной строкой. */}
      <Text Component="div" className={PROSE}>
        {report.description}
      </Text>
      {/* Ответ модерации (resolutionNote из контракта) — только он
          различает «рассмотрена» и «отклонена» по сути, поэтому он и
          стоит отдельным блоком, а не строкой статуса. */}
      {report.resolutionNote ? (
        <Notice tone={report.status === "resolved" ? "success" : "info"}>
          <strong>Ответ модерации</strong>
          {report.resolutionNote}
        </Notice>
      ) : null}
    </Stack>
  );
}
