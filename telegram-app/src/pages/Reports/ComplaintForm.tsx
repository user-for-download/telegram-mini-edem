import { useRef, useState } from "react";
import { Select, Textarea } from "@telegram-apps/telegram-ui";
import {
  REPORT_CATEGORY_LABELS,
  hasExistingReport,
  isReportCategory,
  reportErrorMessage,
  validateReportForm,
  type ReportFieldError,
} from "./reportValidation";
import { reportTargetKey, reportTargetLabel } from "./reportTarget";
import {
  REPORT_CATEGORIES,
  REPORT_DESCRIPTION_MAX_LENGTH,
} from "@edem/contracts";
import type { Report } from "@edem/contracts";
import { Button } from "@/ui/Button";
import { CharCounter } from "@/ui/CharCounter";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { MutationError } from "@/components/MutationError";
import { useToast } from "@/components/Toast/ToastProvider";
import {
  useCreateReportMutation,
  useReportTargetsQuery,
} from "@/queries/useReportQuery";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { haptic } from "@/utils/haptics";

interface ComplaintDraft {
  targetKey: string;
  category: (typeof REPORT_CATEGORIES)[number];
  description: string;
}

/**
 * Форма жалобы — тело всплывающего окна `ComplaintModal`.
 *
 * Раньше лежала секцией во весь экран на странице /profile/reports; там же
 * список своих жалоб. Теперь страница — это список (статусы и ответы
 * модерации), а написать жалобу — кнопка «Подать жалобу» под списком и
 * окно. Тот же приём, что в поддержке (`FeedbackModal`).
 *
 * Объект жалобы ВЫБИРАЕТСЯ из списка `GET /reports/targets`, а не вводится
 * UUID руками: пользователь не видит id объекта ни на одном экране, а
 * «правильных» id — только объекты, где он участник (canReport). Список
 * собирает бэкенд по тем же правилам, поэтому всё, что можно выбрать,
 * сервер примет. Тип и id приходят одной опцией — рассинхрон невозможен.
 *
 * Лимит «одна жалоба на объект» считается по `reports` — списку, который
 * держит страница: сервер всё равно источник правды (409), хинт нужен, чтобы
 * не отправлять заведомо отказ.
 *
 * id полей (`report-target`, `report-category`, `report-description`) —
 * контракт формы; на них ссылается reportValidation (`reportErrorMessage`
 * возвращает id поля).
 *
 * Dirty-guard едет вместе с формой: пока объект/описание не пусты, закрытие
 * приложения спрашивает подтверждение — черновик жалобы терять жалко.
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
  const targets = useReportTargetsQuery();
  // Выбор держим ключом «тип:id», а не готовым объектом: при перезапросе
  // списка объект ищем заново, и выбор не рассинхронится с новыми данными.
  const [form, setForm, , captureSubmission] = useSessionDraft<ComplaintDraft>(
    "complaint:new",
    { targetKey: "", category: "safety", description: "" },
  );
  const { targetKey, category, description } = form;
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

  const list = targets.data ?? [];
  const selected =
    list.find((target) => reportTargetKey(target) === targetKey) ?? null;
  const noTargets = !targets.isLoading && !targets.isError && list.length === 0;
  const targetUnavailable =
    targetKey !== "" && !selected && !targets.isLoading && !targets.isError;

  useClosingConfirmation(targetKey !== "" || description !== "");

  const alreadyReported =
    selected !== null &&
    hasExistingReport(reports, selected.targetType, selected.id);

  const submit = () => {
    if (
      create.isPending || submitGuard.current || !selected ||
      targets.isLoading || targets.isError
    ) return;
    const validationError = validateReportForm(description);
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
    const onCommitted = captureSubmission();
    create.mutate(
      {
        targetType: selected.targetType,
        targetId: selected.id,
        category,
        description: description.trim(),
        onCommitted,
      },
      {
        onSettled: () => {
          submitGuard.current = false;
        },
        onSuccess: () => {
          if (!onCommitted()) return;
          haptic.success();
          // Тост, а не inline-Notice: после отправки окно закрывается, и
          // Notice уехал бы вместе с ним (как в форме обращения в поддержку).
          toast.show({
            text: "Жалоба отправлена",
            description:
              "Модерация ответит в приложении — ответ появится в списке",
          });
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
    selected !== null &&
    description.trim().length > 0 &&
    !alreadyReported &&
    !targets.isLoading &&
    !targets.isError &&
    !create.isPending;

  return (
    <>
      <MutationError error={create.error} />
      {targets.isError && (
        <>
          <Notice tone="danger" variant="text">
            Не удалось загрузить объекты для жалобы.
          </Notice>
          {/* Повтор точечный (не через QueryState): вышел из строя один
              запрос — сам список объектов, а не страница. */}
          <Button
            variant="ghost"
            size="m"
            onClick={() => void targets.refetch()}
          >
            Повторить
          </Button>
        </>
      )}
      <Field
        label="На что жалуетесь"
        id="report-target"
        error={
          targetUnavailable
            ? "Выбранный объект больше недоступен — выберите другой"
            : undefined
        }
      >
        {(field) => (
          <Select
            {...field}
            value={selected ? targetKey : ""}
            disabled={targets.isLoading || targets.isError || noTargets}
            onChange={(event) => {
              const targetKey = event.target.value;
              setForm((current) => ({ ...current, targetKey }));
              setFieldError(null);
              if (formError) setFormError(null);
            }}
          >
            <option value="">
              {targets.isLoading ? "Загрузка…" : "Выберите объект"}
            </option>
            {list.map((target) => {
              const key = reportTargetKey(target);
              return (
                <option key={key} value={key}>
                  {reportTargetLabel(target)}
                </option>
              );
            })}
          </Select>
        )}
      </Field>
      {noTargets && (
        <Notice tone="info" variant="text">
          Нет объектов, на которые можно пожаловаться: жалоба доступна
          участникам поездки в течение 7 дней после её окончания.
        </Notice>
      )}
      <Field label="Причина" id="report-category">
        {(field) => (
          <Select
            {...field}
            value={category}
            onChange={(event) => {
              const next = event.target.value;
              if (!isReportCategory(next)) return;
              setForm((current) => ({ ...current, category: next }));
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
              const description = event.target.value;
              setForm((current) => ({ ...current, description }));
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
        variant="primary"
        loading={create.isPending}
        disabled={!canSubmit}
        onClick={submit}
      >
        {alreadyReported ? "Жалоба уже отправлена" : "Отправить жалобу"}
      </Button>
    </>
  );
}
