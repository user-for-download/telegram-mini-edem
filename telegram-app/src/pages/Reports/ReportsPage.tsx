import { memo, useState } from "react";
import { Caption, Text, VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { PROSE } from "@/ui/classes";
import { Button } from "@/ui/Button";
import { ComplaintModal } from "./ComplaintModal";
import { useModalBack } from "@/utils/modalBack";

import type { Report } from "@edem/contracts";
import { Card } from "@/ui/Card";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { Flag } from "lucide-react";
import {
  StatusPill,
  type StatusTone,
} from "@/components/StatusPill/StatusPill";
import { QueryState } from "@/components/QueryState";
import { Page } from "@/ui/Page";
import { Section } from "@/ui/Section";
import { SectionBody } from "@/ui/SectionBody";
import { Stack } from "@/ui/Stack";
import { ApiError } from "@/api/client";
import { haptic } from "@/utils/haptics";
import { moscowNumericDate } from "@/utils/date";
import { useMyReportsQuery } from "@/queries/useReportQuery";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
} from "./reportValidation";
import styles from "./ReportsPage.module.css";

// Дата жалобы — по Москве, как всё остальное время в приложении
// (moscowNumericDate). Локальная копия toLocaleDateString без timeZone
// показывала дату в зоне устройства: жалоба от 01.10 22:30 UTC клиенту
// в Лос-Анджелесе приходила как «01.10.2026» вместо «02.10.2026».
const formatDate = moscowNumericDate;

/** Тон статус-пилюли жалобы: ожидание — warning, работа — info,
 * решение — success, отказ — danger. */
function reportStatusTone(status: Report["status"]): StatusTone {
  switch (status) {
    case "resolved":
      return "success";
    case "rejected":
      return "danger";
    case "in_review":
      return "info";
    default:
      return "warning";
  }
}

const ReportCard = memo(function ReportCard({ report }: { report: Report }) {
  return (
    <Card className={styles.card}>
      <div className={styles.cardHead}>
        <Text weight="2" Component="span">
          {`${REPORT_CATEGORY_LABELS[report.category]} · ${REPORT_TARGET_TYPE_LABELS[report.targetType]}`}
        </Text>
        <StatusPill
          tone={reportStatusTone(report.status)}
          className={styles.pill}
        >
          {REPORT_STATUS_LABELS[report.status]}
        </StatusPill>
      </div>
      <Caption Component="span">{formatDate(report.createdAt)}</Caption>
      <Text Component="div" className={PROSE}>
        {report.description}
      </Text>
      {/* Ответ модерации (resolutionNote из контракта). */}
      {report.resolutionNote ? (
        <Notice tone={report.status === "resolved" ? "success" : "info"}>
          <strong>Ответ модерации</strong>
          {report.resolutionNote}
        </Notice>
      ) : null}
    </Card>
  );
});

/**
 * Жалобы — отдельная страница /profile/reports (без Modal/портала):
 * тело — полноэкранная страница без смены контракта.
 *
 * - создание: тип объекта + идентификатор + категория + описание (≤ 2000);
 * - клиентский хинт лимита «1 жалоба навсегда» (hasExistingReport),
 *   сервер — источник правды (409);
 * - список своих жалоб со статусами модерации.
 *
 * Dirty-guard: useClosingConfirmation держит нативное подтверждение
 * закрытия миника при черновике (targetId/description) — на странице это
 * уход со страницы/закрытие приложения, а не закрытие модалки. Хук
 * сам снимает флаг в cleanup при размонтировании страницы.
 *
 * a11y: интерактив — таргеты ≥44px (нативный MIN_TARGET), счётчик и хинт лимита —
 * aria-live, ошибки — role=alert, успех — role=status.
 */
export function ReportsPage() {
  // Форма жалобы — во всплывающем окне (ComplaintModal): страница показывает
  // список и ответы модерации, Back закрывает окно через useModalBack.
  const [complaintOpen, setComplaintOpen] = useState(false);
  useModalBack(() => setComplaintOpen(false), complaintOpen);
  const myReports = useMyReportsQuery();

  // Бан mid-session: requireUser отвечает 403 — терминальный экран вместо
  // общей ошибки (паттерн ProfilePage; глобальные случаи закрывает AuthGate).
  if (myReports.error instanceof ApiError && myReports.error.status === 403) {
    return (
      <AccountStatePage
        title="Аккаунт заблокирован"
        description="Действие недоступно: аккаунт заблокирован."
      />
    );
  }

  return (
    <>
      <Page>
        {/* NavHeader помечен aria-hidden («авторитетные h1 живут на
            страницах»), а секции фасад отдаёт как h2 — имя экрана даёт
            скрытый h1. */}
        <VisuallyHidden Component="h1">Мои обращения</VisuallyHidden>
        <Section header="Мои жалобы">
          <SectionBody>
            <QueryState
              loading={myReports.isLoading}
              error={myReports.error}
              empty={false}
              emptyText=""
              onRetry={() => void myReports.refetch()}
            >
              {!myReports.data || myReports.data.length === 0 ? (
                <EmptyState
                  header={EMPTY_STATES.reportsEmpty.header}
                  description={EMPTY_STATES.reportsEmpty.description}
                />
              ) : (
                <Stack>
                  {myReports.data.map((report) => (
                    <ReportCard key={report.id} report={report} />
                  ))}
                </Stack>
              )}
            </QueryState>
            {/* Подать жалобу — из окна: страница отвечает за список и ответы
                модерации, а полноэкранная форма занимала её целиком. Тот же
                приём, что у обращения в поддержку. */}
            <Button
              stretched
              size="m"
              before={<Flag size={16} />}
              onClick={() => {
                haptic.light();
                setComplaintOpen(true);
              }}
            >
              Подать жалобу
            </Button>
          </SectionBody>
        </Section>
      </Page>
      <ComplaintModal
        open={complaintOpen}
        onClose={() => setComplaintOpen(false)}
        reports={myReports.data ?? []}
      />
    </>
  );
}
