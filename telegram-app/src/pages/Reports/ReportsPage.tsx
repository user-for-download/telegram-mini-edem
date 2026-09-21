import { useRef, useState } from "react";
import {
  Button,
  Caption,
  Input,
  Placeholder,
  Section,
  Select,
  Text,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { REPORT_CATEGORIES, type Report } from "@edem/contracts";
import { REPORT_DESCRIPTION_MAX_LENGTH } from "@edem/contracts";
import { PageHeader } from "@/components/PageHeader";
import { FeedCard } from "@/components/FeedCard";
import { StatusPill, type StatusTone } from "@/components/StatusPill";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { ApiError } from "@/api/client";
import {
  useCreateReportMutation,
  useMyReportsQuery,
} from "@/queries/useReportQuery";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TARGET_TYPE_LABELS,
  hasExistingReport,
  isReportCategory,
  isReportTargetType,
  reportErrorMessage,
  validateReportForm,
  type ReportTargetType,
} from "@/pages/reportValidation";
import styles from "./ReportsPage.module.css";

function formatDate(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt;
  return date.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

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

function ReportCard({ report }: { report: Report }) {
  return (
    <FeedCard className={styles.card}>
      <div className={styles.cardHead}>
        <Text weight="2" Component="span">
          {`${REPORT_CATEGORY_LABELS[report.category]} · ${REPORT_TARGET_TYPE_LABELS[report.targetType]}`}
        </Text>
        <StatusPill tone={reportStatusTone(report.status)} className={styles.pill}>
          {REPORT_STATUS_LABELS[report.status]}
        </StatusPill>
      </div>
      <Caption Component="span">{formatDate(report.createdAt)}</Caption>
      <Text Component="div" className={styles.prose}>
        {report.description}
      </Text>
    </FeedCard>
  );
}

/**
 * Жалобы Telegram-приложения (порт VK ReportModal как отдельный раздел +
 * список своих жалоб):
 * - создание: тип объекта + идентификатор + категория + описание (≤ 2000);
 * - клиентский хинт лимита «1 жалоба навсегда» (hasExistingReport),
 *   сервер — источник правды (409);
 * - список своих жалоб со статусами модерации.
 */
export function ReportsPage() {
  const [targetType, setTargetType] = useState<ReportTargetType>("trip");
  const [targetId, setTargetId] = useState("");
  const [category, setCategory] =
    useState<(typeof REPORT_CATEGORIES)[number]>("safety");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос (паттерн VK).
  const submitGuard = useRef(false);

  const myReports = useMyReportsQuery();
  const create = useCreateReportMutation();

  const alreadyReported = hasExistingReport(
    myReports.data ?? [],
    targetType,
    targetId,
  );

  const submit = () => {
    if (create.isPending || submitGuard.current) return;
    const validationError = validateReportForm(targetId, description);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    if (alreadyReported) {
      setFormError(
        "Жалоба уже отправлена: повторная жалоба на этот объект недоступна.",
      );
      return;
    }
    setFormError(null);
    setSuccess(false);
    submitGuard.current = true;
    create.mutate(
      {
        targetType,
        targetId: targetId.trim(),
        category,
        description: description.trim(),
      },
      {
        onSettled: () => {
          submitGuard.current = false;
        },
        onSuccess: () => {
          setTargetId("");
          setDescription("");
          setSuccess(true);
        },
        onError: (error) => setFormError(reportErrorMessage(error)),
      },
    );
  };

  const canSubmit =
    targetId.trim().length > 0 &&
    description.trim().length > 0 &&
    !alreadyReported &&
    !create.isPending;

  // Бан mid-session: requireUser отвечает 403 — терминальный экран вместо
  // общей ошибки (паттерн ProfilePage; глобальные случаи закрывает AuthGate).
  if (myReports.error instanceof ApiError && myReports.error.status === 403) {
    return (
      <>
        <PageHeader title="Жалобы" />
        <Placeholder
          header="Аккаунт заблокирован"
          description="Действие недоступно: аккаунт заблокирован."
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Жалобы" />

      <div className={styles.wrap}>
        <Section header="Сообщите о проблеме">
          <div className={styles.panel}>
            <MutationError error={create.error} />
            <div>
              <label htmlFor="report-target-type" className="sr-only">
                Что случилось
              </label>
              <Select
                id="report-target-type"
                header="Что случилось"
                value={targetType}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!isReportTargetType(next)) return;
                  setTargetType(next);
                  if (formError) setFormError(null);
                }}
              >
                {(
                  Object.keys(REPORT_TARGET_TYPE_LABELS) as ReportTargetType[]
                ).map((value) => (
                  <option key={value} value={value}>
                    {REPORT_TARGET_TYPE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="report-target-id" className="sr-only">
                Идентификатор объекта
              </label>
              <Input
                id="report-target-id"
                header="Идентификатор объекта"
                placeholder="Например: идентификатор поездки из её страницы"
                value={targetId}
                onChange={(event) => {
                  setTargetId(event.target.value);
                  if (formError) setFormError(null);
                  if (success) setSuccess(false);
                }}
              />
            </div>
            <div>
              <label htmlFor="report-category" className="sr-only">
                Причина
              </label>
              <Select
                id="report-category"
                header="Причина"
                value={category}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!isReportCategory(next)) return;
                  setCategory(next);
                }}
              >
                {REPORT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {REPORT_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="report-description" className="sr-only">
                Описание
              </label>
              <Textarea
                id="report-description"
                header="Описание"
                rows={4}
                maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
                placeholder="Опишите, что произошло"
                value={description}
                aria-invalid={Boolean(formError)}
                status={formError ? "error" : undefined}
                onChange={(event) => {
                  setDescription(event.target.value);
                  if (formError) setFormError(null);
                  if (success) setSuccess(false);
                }}
              />
            </div>
            {description.length > 0 && (
              <Caption Component="p" className={styles.counter} aria-live="polite">
                {description.length}/{REPORT_DESCRIPTION_MAX_LENGTH}
              </Caption>
            )}
            {alreadyReported && (
              <Caption Component="p" className={styles.counter} aria-live="polite">
                Вы уже отправляли жалобу на этот объект. Повторная отправка
                недоступна.
              </Caption>
            )}
            {formError && (
              <Caption
                Component="p"
                role="alert"
                className={styles.errorText}
              >
                {formError}
              </Caption>
            )}
            {success && (
              <Text
                Component="p"
                role="status"
                className={styles.successText}
              >
                Жалоба отправлена
              </Text>
            )}
            <Button
              mode="bezeled"
              stretched
              size="l"
              loading={create.isPending}
              disabled={!canSubmit}
              onClick={submit}
            >
              {alreadyReported ? "Жалоба уже отправлена" : "Отправить жалобу"}
            </Button>
          </div>
        </Section>

        <Section header="Мои жалобы">
          <div className={styles.panel}>
            <QueryState
              loading={myReports.isLoading}
              error={myReports.error}
              empty={false}
              emptyText=""
              onRetry={() => void myReports.refetch()}
            >
              {!myReports.data || myReports.data.length === 0 ? (
                <Placeholder
                  header="Вы пока не отправляли жалоб"
                  description="Жалобы на поездки доступны пассажирам с бронью. На свою поездку жаловаться нельзя."
                />
              ) : (
                <div className={styles.list}>
                  {myReports.data.map((report) => (
                    <ReportCard key={report.id} report={report} />
                  ))}
                </div>
              )}
            </QueryState>
          </div>
        </Section>
      </div>
    </>
  );
}
