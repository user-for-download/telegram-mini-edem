import { useRef, useState } from "react";
import { Input, Select, Textarea } from "@telegram-apps/telegram-ui";
import {
  REPORT_CATEGORY_LABELS,
  REPORT_TARGET_TYPE_LABELS,
  hasExistingReport,
  isReportCategory,
  isReportTargetType,
  reportErrorMessage,
  validateReportForm,
  type ReportFieldError,
  type ReportTargetType,
} from "./reportValidation";
import { REPORT_CATEGORIES, REPORT_DESCRIPTION_MAX_LENGTH } from "@edem/contracts";
import type { Report } from "@edem/contracts";
import { Button } from "@/ui/Button";
import { CharCounter } from "@/ui/CharCounter";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { MutationError } from "@/components/MutationError";
import { useToast } from "@/components/Toast/ToastProvider";
import { useCreateReportMutation } from "@/queries/useReportQuery";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { haptic } from "@/utils/haptics";

/**
 * Форма жалобы — тело всплывающего окна `ComplaintModal`.
 *
 * Раньше лежала секцией во весь экран на странице /profile/reports; там же
 * список своих жалоб. Теперь страница — это список (статусы и ответы
 * модерации), а написать жалобу — кнопка «Подать жалобу» под списком и
 * окно. Тот же приём, что в поддержке (`FeedbackModal`).
 *
 * Лимит «одна жалоба на объект» считается по `reports` — списку, который
 * держит страница: сервер всё равно источник правды (409), хинт нужен, чтобы
 * не отправлять заведомо отказ.
 *
 * id полей (`report-target-type`, `report-target-id`, `report-category`,
 * `report-description`) — контракт формы; на них ссылается
 * reportValidation (`reportErrorMessage` возвращает id поля).
 *
 * Dirty-guard едет вместе с формой: пока targetId/description не пусты,
 * закрытие приложения спрашивает подтверждение — черновик жалобы терять
 * жалко.
 */
export function ComplaintForm({
  reports,
  onSubmitted,
}: {
  /** Свои жалобы — для хинта «уже отправлено» по этому объекту. */
  reports: Report[];
  onSubmitted?: () => void;
}) {
  const toast = useToast();
  const create = useCreateReportMutation();
  const [targetType, setTargetType] = useState<ReportTargetType>("trip");
  const [targetId, setTargetId] = useState("");
  const [category, setCategory] =
    useState<(typeof REPORT_CATEGORIES)[number]>("safety");
  const [description, setDescription] = useState("");
  // Клиентская ошибка приходит с полем: <Field error=…> ставит aria-invalid и
  // aria-describedby сам. formError остаётся для ошибок, которые не
  // принадлежат конкретному полю: лимит «одна жалоба» и ответ сервера.
  const [fieldError, setFieldError] = useState<ReportFieldError | null>(null);
  const errorFor = (id: string) =>
    fieldError?.field === id ? fieldError.message : undefined;
  const [formError, setFormError] = useState<string | null>(null);
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос.
  const submitGuard = useRef(false);

  useClosingConfirmation(targetId !== "" || description !== "");

  const alreadyReported = hasExistingReport(reports, targetType, targetId);

  const submit = () => {
    if (create.isPending || submitGuard.current) return;
    const validationError = validateReportForm(targetId, description);
    if (validationError) {
      setFieldError(validationError);
      return;
    }
    setFieldError(null);
    if (alreadyReported) {
      setFormError(
        "Жалоба уже отправлена: повторная жалоба на этот объект недоступна.",
      );
      return;
    }
    setFormError(null);
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
          // Тост, а не inline-Notice: после отправки окно закрывается, и
          // Notice уехал бы вместе с ним (как в форме обращения в поддержку).
          toast.show({
            text: "Жалоба отправлена",
            description: "Модерация ответит в приложении — ответ появится в списке",
          });
          setTargetId("");
          setDescription("");
          onSubmitted?.();
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

  return (
    <>
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
      <Field
        label="Идентификатор объекта"
        id="report-target-id"
        error={errorFor("report-target-id")}
      >
        {(field) => (
          <Input
            {...field}
            placeholder="Например: идентификатор поездки из её страницы"
            value={targetId}
            status={errorFor("report-target-id") ? "error" : undefined}
            onChange={(event) => {
              setTargetId(event.target.value);
              setFieldError(null);
              if (formError) setFormError(null);
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
      <Field
        label="Описание"
        id="report-description"
        error={errorFor("report-description")}
      >
        {(field) => (
          <Textarea
            {...field}
            rows={4}
            maxLength={REPORT_DESCRIPTION_MAX_LENGTH}
            placeholder="Опишите, что произошло"
            value={description}
            status={errorFor("report-description") ? "error" : undefined}
            onChange={(event) => {
              setDescription(event.target.value);
              setFieldError(null);
              if (formError) setFormError(null);
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
      <Button
        stretched
        size="l"
        loading={create.isPending}
        disabled={!canSubmit}
        onClick={submit}
      >
        {alreadyReported ? "Жалоба уже отправлена" : "Отправить жалобу"}
      </Button>
    </>
  );
}
