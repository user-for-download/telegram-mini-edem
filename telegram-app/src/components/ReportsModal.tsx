import { memo, useRef, useState } from "react";
import {
  Button,
  Input,
  Modal,
  Placeholder,
  Select,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { REPORT_CATEGORIES, type Report } from "@edem/contracts";
import { REPORT_DESCRIPTION_MAX_LENGTH } from "@edem/contracts";
import { useNavigate } from "react-router-dom";
import { MutationError } from "@/components/MutationError";
import { FeedCard } from "@/components/FeedCard";
import { QueryState } from "@/components/QueryState";
import { ProfilePage } from "@/pages/ProfilePage";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
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
function reportStatusTone(status: Report["status"]): string {
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
    <FeedCard className="p-3.5 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-semibold text-(--tgui--text_color)">
          {`${REPORT_CATEGORY_LABELS[report.category]} · ${REPORT_TARGET_TYPE_LABELS[report.targetType]}`}
        </span>
        <span className="StatusPill shrink-0" data-tone={reportStatusTone(report.status)}>
          {REPORT_STATUS_LABELS[report.status]}
        </span>
      </div>
      <span className="text-[11px] text-(--tgui--hint_color)">
        {formatDate(report.createdAt)}
      </span>
      <div className="text-[13px] text-(--tgui--text_color) leading-relaxed">
        {report.description}
      </div>
    </FeedCard>
  );
});

/**
 * Жалобы — модальная шторка поверх «Профиля» (модель примера:
 * CreateTripModal/NotificationsModal; в Telegram нет «новых страниц»,
 * только модалки; роут /profile/reports остаётся источником правды,
 * вход из ProfilePage — тот же navigate("/profile/reports")).
 *
 * a11y: telegram-ui Modal даёт role=dialog, Esc-закрытие (onOpenChange) и
 * focus-trap; интерактив в теле — таргеты ≥44px (min-h), счётчик и
 * хинт лимита — aria-live, ошибки — role=alert, успех — role=status.
 */
export function ReportsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Жалобы</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto">
        <ReportsBody />
      </div>
    </Modal>
  );
}

/**
 * Роут /profile/reports: фон — «Профиль» (точка входа ProfilePage:361),
 * поверх — шторка жалоб. Закрытие — назад по истории (native Back/Shell
 * backButton через handleModalBack — стек пуст для route-модалок →
 * navigate(-1)), иначе fallback на /profile. Путь не меняется.
 * PageHeader с back-кнопкой внутри тела нет — закрытие через header модалки.
 */
export function ReportsRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  };
  return (
    <>
      <ProfilePage />
      <ReportsModal open onClose={close} />
    </>
  );
}

/**
 * Тело жалоб (экспортировано для SSR-тестов: Modal — портал, в
 * renderToString не попадает). Мемоизировано (форма + список жалоб).
 * Без PageHeader — закрытие через header модалки.
 *
 * Создание: тип объекта + идентификатор + категория + описание (≤ 2000);
 * клиентский хинт лимита «1 жалоба навсегда» (hasExistingReport),
 * сервер — источник правды (409); список своих жалоб со статусами.
 */
export const ReportsBody = memo(function ReportsBody() {
  const [targetType, setTargetType] = useState<ReportTargetType>("trip");
  const [targetId, setTargetId] = useState("");
  const [category, setCategory] = useState<(typeof REPORT_CATEGORIES)[number]>("safety");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  useClosingConfirmation(targetId !== "" || description !== "");
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
      setFormError("Жалоба уже отправлена: повторная жалоба на этот объект недоступна.");
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
  // PageHeader здесь нет — закрытие через header модалки.
  if (myReports.error instanceof ApiError && myReports.error.status === 403) {
    return (
      <Placeholder
        header="Аккаунт заблокирован"
        description="Действие недоступно: аккаунт заблокирован."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3.5 pt-1 pb-6">
      <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-(--tgui--text_color)">
          Сообщите о проблеме
        </span>
        <MutationError error={create.error} />
        <div className="FormField">
          <label htmlFor="report-target-type">Что случилось</label>
          <Select
            id="report-target-type"
            value={targetType}
            onChange={(event) => {
              const next = event.target.value;
              if (!isReportTargetType(next)) return;
              setTargetType(next);
              if (formError) setFormError(null);
            }}
          >
            {(Object.keys(REPORT_TARGET_TYPE_LABELS) as ReportTargetType[]).map(
              (value) => (
                <option key={value} value={value}>
                  {REPORT_TARGET_TYPE_LABELS[value]}
                </option>
              ),
            )}
          </Select>
        </div>
        <div className="FormField">
          <label htmlFor="report-target-id">Идентификатор объекта</label>
          <Input
            id="report-target-id"
            placeholder="Например: идентификатор поездки из её страницы"
            value={targetId}
            onChange={(event) => {
              setTargetId(event.target.value);
              if (formError) setFormError(null);
              if (success) setSuccess(false);
            }}
          />
        </div>
        <div className="FormField">
          <label htmlFor="report-category">Причина</label>
          <Select
            id="report-category"
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
        <div className="FormField">
          <label htmlFor="report-description">Описание</label>
          <Textarea
            id="report-description"
            rows={4}
            maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
            placeholder="Опишите, что произошло"
            value={description}
            aria-invalid={Boolean(formError)}
            status={formError ? "error" : "default"}
            onChange={(event) => {
              setDescription(event.target.value);
              if (formError) setFormError(null);
              if (success) setSuccess(false);
            }}
          />
        </div>
        {description.length > 0 && (
          <p className="ReviewCounter" aria-live="polite">
            {description.length}/{REPORT_DESCRIPTION_MAX_LENGTH}
          </p>
        )}
        {alreadyReported && (
          <p className="ReviewCounter" aria-live="polite">
            Вы уже отправляли жалобу на этот объект. Повторная отправка недоступна.
          </p>
        )}
        {formError && (
          <p className="FormError" role="alert">
            {formError}
          </p>
        )}
        {success && (
          <p className="ReviewSuccess" role="status">
            Жалоба отправлена
          </p>
        )}
        <Button
          stretched
          size="l"
          className="min-h-11"
          loading={create.isPending}
          disabled={!canSubmit}
          onClick={submit}
        >
          {alreadyReported ? "Жалоба уже отправлена" : "Отправить жалобу"}
        </Button>
      </div>

      <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
        <span className="text-[13px] font-semibold text-(--tgui--text_color)">
          Мои жалобы
        </span>
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
            <div className="flex flex-col gap-3">
              {myReports.data.map((report) => (
                <ReportCard key={report.id} report={report} />
              ))}
            </div>
          )}
        </QueryState>
      </div>
    </div>
  );
});
