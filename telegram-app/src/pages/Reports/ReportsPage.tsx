import { memo, useState } from "react";
import { VisuallyHidden } from "@telegram-apps/telegram-ui";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Cell } from "@/ui/Cell";
import { Button } from "@/ui/Button";
import { ComplaintModal } from "./ComplaintModal";
import { ReportDetailsModal } from "./ReportDetailsModal";
import { useModalBack } from "@/utils/modalBack";

import type { Report } from "@edem/contracts";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { ChevronRight, Flag } from "lucide-react";
import { Info } from "@telegram-apps/telegram-ui";
import { QueryState } from "@/components/QueryState";
import { Page } from "@/ui/Page";
import { Section } from "@/ui/Section";
import { SectionBody } from "@/ui/SectionBody";
import { ApiError } from "@/api/client";
import { haptic } from "@/utils/haptics";
import { moscowNumericDate } from "@/utils/date";
import { useMyReportsQuery } from "@/queries/useReportQuery";
import { REPORT_STATUS_LABELS } from "./reportValidation";
import {
  reportCellAriaLabel,
  reportPreviewSubtitle,
  reportPreviewTitle,
  reportStatusTone,
} from "./reportPreview";
import styles from "./ReportsPage.module.css";

// Дата жалобы — по Москве, как всё остальное время в приложении
// (moscowNumericDate). Локальная копия toLocaleDateString без timeZone
// показывала дату в зоне устройства: жалоба от 01.10 22:30 UTC клиенту
// в Лос-Анджелесе приходила как «01.10.2026» вместо «02.10.2026».

/**
 * Строка жалобы — как строка уведомления: три короткие строки + правая
 * колонка с шевроном и датой.
 *
 * Было `Card` с развёрнутым текстом: длинное описание и ответ модерации
 * раздавливали ленту, и страница выглядела иначе, чем остальные списки
 * приложения. Полный текст и ответ уехали в попап (ReportDetailsModal).
 *
 * Строка ВСЕГДА интерактивна (тап открывает попап), поэтому нативная кнопка
 * `Component="button"` — свой `onKeyDown` не нужен, Enter/Space сработают
 * сами. В уведомлениях пришлось городить `div`+`role="button"`+`onKeyDown`
 * только из-за их обработчика; здесь такого требования нет, и удвоенного
 * вызова не будет.
 */
const ReportCell = memo(function ReportCell({
  report,
  onOpen,
}: {
  report: Report;
  onOpen: (id: string) => void;
}) {
  const subtitle = reportPreviewSubtitle(report);
  return (
    <Cell
      Component="button"
      type="button"
      className={styles.cell}
      subtitle={subtitle}
      /* Строка 3 — статус: та же трёхстрочная раскладка, что у уведомлений
         (title / subtitle / description). Статус в ленте обязателен — по
         нему видно, какие жалобы уже рассмотрены, а в попапе пришлось бы
         открывать каждую. Текстом, а не пилюлей: в правой колонке уже дата,
         и второй «остров» тянул бы строку в две части. Смысл всегда
         продублирован словами, цвет — только подсказка (a11y: color + text). */
      description={
        <span
          data-testid={`report-status-${report.id}`}
          data-tone={reportStatusTone(report.status)}
          className={styles.status}
        >
          {REPORT_STATUS_LABELS[report.status]}
        </span>
      }
      after={
        <Info
          type="text"
          className={styles.info}
          subtitle={moscowNumericDate(report.createdAt)}
        >
          <ChevronRight size={16} className={styles.chevron} aria-hidden />
        </Info>
      }
      aria-label={reportCellAriaLabel(report)}
      data-testid={`report-cell-${report.id}`}
      onClick={() => {
        haptic.light();
        onOpen(report.id);
      }}
    >
      {reportPreviewTitle(report)}
    </Cell>
  );
});

/**
 * Жалобы — отдельная страница /profile/reports (без Modal/портала):
 * тело — полноэкранная страница без смены контракта.
 *
 * - список своих жалоб строками `Cell` (как уведомления), детали — в попапе
 *   по тапу;
 * - создание жалобы — в отдельном окне (ComplaintModal);
 * - клиентский хинт лимита «1 жалоба навсегда» (hasExistingReport),
 *   сервер — источник правды (409).
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
  const [complaintOpen, setComplaintOpen] = useState(false);
  // Открытая жалоба держим по id, а не самим объектом: после инвалидации
  // кэша (отправлена новая жалоба, статус уехал в «На рассмотрении»)
  // страница должна перерисовать попап по новым данным, а не держать копию.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const myReports = useMyReportsQuery();

  const selected =
    myReports.data?.find((report) => report.id === selectedId) ?? null;

  useModalBack(() => setComplaintOpen(false), complaintOpen);
  // Подписка на Back для попапа идёт ПОСЛЕ формы подачи: стек LIFO, и при
  // открытых обоих окнах верхним должен закрываться попап — последний, кто
  // подписался. Обратный порядок закрыл бы форму подачи вместо деталей.
  useModalBack(() => setSelectedId(null), selected !== null);

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
        <VisuallyHidden Component="h1">Жалобы</VisuallyHidden>
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
                /* Лента — прямые Cell внутри Section: кит сам вставляет
                   Divider между строками (паттерн NotificationsPage). */
                <div className={styles.list}>
                  {myReports.data.map((report) => (
                    <ReportCell
                      key={report.id}
                      report={report}
                      onOpen={setSelectedId}
                    />
                  ))}
                </div>
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
      <ReportDetailsModal
        report={selected}
        onClose={() => setSelectedId(null)}
      />
      <ComplaintModal
        open={complaintOpen}
        onClose={() => setComplaintOpen(false)}
        reports={myReports.data ?? []}
      />
    </>
  );
}
