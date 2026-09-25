import { memo, useRef, useState } from "react";
import {
  Caption,
  Input,
  Section,
  Select,
  Text,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { PROSE } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { CharCounter } from "@/ui/CharCounter";
import { Button } from "@/ui/Button";

import { REPORT_CATEGORIES, type Report } from "@edem/contracts";
import { REPORT_DESCRIPTION_MAX_LENGTH } from "@edem/contracts";
import { Card } from "@/ui/Card";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import {
  StatusPill,
  type StatusTone,
} from "@/components/StatusPill/StatusPill";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Stack } from "@/ui/Stack";
import { ApiError } from "@/api/client";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
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
} from "./reportValidation";
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
  const [targetType, setTargetType] = useState<ReportTargetType>("trip");
  const [targetId, setTargetId] = useState("");
  const [category, setCategory] =
    useState<(typeof REPORT_CATEGORIES)[number]>("safety");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Черновик формы — dirty для нативного подтверждения ухода со страницы
  // (enableClosingConfirmation, пока targetId/description не пусты).
  useClosingConfirmation(targetId !== "" || description !== "");
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос (защита от двойного сабмита).
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
          haptic.success();
          setTargetId("");
          setDescription("");
          setSuccess(true);
        },
        onError: (error) => {
          haptic.error();
          setFormError(reportErrorMessage(error));
        },
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
      <AccountStatePage
        title="Аккаунт заблокирован"
        description="Действие недоступно: аккаунт заблокирован."
      />
    );
  }

  return (
    <>
      <Page>
        <Section header="Сообщите о проблеме">
          <SectionBody>
            <MutationError error={create.error} />
            <Field label="Что случилось" id="report-target-type">
              {(field) => (
                <Select
                  {...field}
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
              )}
            </Field>
            <Field label="Идентификатор объекта" id="report-target-id">
              {(field) => (
                <Input
                  {...field}
                  placeholder="Например: идентификатор поездки из её страницы"
                  value={targetId}
                  onChange={(event) => {
                    setTargetId(event.target.value);
                    if (formError) setFormError(null);
                    if (success) setSuccess(false);
                  }}
                />
              )}
            </Field>
            <Field label="Причина" id="report-category">
              {(field) => (
                <Select
                  {...field}
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
              )}
            </Field>
            <Field label="Описание" id="report-description">
              {(field) => (
                <Textarea
                  {...field}
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
              )}
            </Field>
            {description.length > 0 && (
              <CharCounter
                value={description.length}
                max={REPORT_DESCRIPTION_MAX_LENGTH}
              />
            )}
            {alreadyReported && (
              <Notice tone="info" variant="text">
                Вы уже отправляли жалобу на этот объект. Повторная отправка
                недоступна.
              </Notice>
            )}
            {formError && (
              <Notice tone="danger" variant="text">
                {formError}
              </Notice>
            )}
            {success && (
              <Notice tone="success" variant="text">
                Жалоба отправлена
              </Notice>
            )}
            <Button
              stretched
              size="l"
              loading={create.isPending}
              disabled={!canSubmit}
              onClick={submit}
            >
              {alreadyReported ? "Жалоба уже отправлена" : "Отправить жалобу"}
            </Button>
          </SectionBody>
        </Section>

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
          </SectionBody>
        </Section>
      </Page>
    </>
  );
}
