import { useRef, useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import { MessageSquareText, Send } from "lucide-react";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
} from "@edem/contracts";
import { MutationError } from "@/components/MutationError";
import { useToast } from "@/components/Toast/ToastProvider";
import { useCreateFeedbackMutation } from "@/queries/useSupportQuery";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { Button } from "@/ui/Button";
import { CharCounter } from "@/ui/CharCounter";
import { HINT } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { haptic } from "@/utils/haptics";
import {
  normalizeSupportForm,
  validateSupportForm,
  type SupportField,
  type SupportFieldError,
} from "./supportValidation";

interface FeedbackDraft {
  subject: string;
  text: string;
}

/**
 * Форма обращения в поддержку — тело всплывающего окна `FeedbackModal`.
 *
 * Раньше та же форма лежала секцией прямо на странице /profile/support, а
 * параллельно существовала шторка с дублем. Теперь реализация одна, и живёт
 * она в окне: страница показывает FAQ и историю обращений, а написать
 * новое — кнопка «Создать обращение» под списком.
 *
 * id полей (`support-subject`, `support-text`) — контракт e2e-сценария
 * telegram-parity и замера контраста плейсхолдеров (ui-contrast).
 *
 * Подтверждение — тостом, а не `Notice` внутри формы: после отправки окно
 * закрывается, и `Notice` уехал бы вместе с ним, оставив пользователя без
 * подтверждения. Так же подтверждаются публикация поездки, отправка отзыва
 * и прочие действия приложения.
 */
export function FeedbackForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const toast = useToast();
  const create = useCreateFeedbackMutation();
  const [form, setForm, , captureSubmission] = useSessionDraft<FeedbackDraft>(
    "support:new",
    { subject: "", text: "" },
  );
  const { subject, text } = form;
  // Клиентская ошибка приходит С ПОЛЕМ: <Field error=…> сам ставит
  // aria-invalid + aria-describedby и рисует текст рядом с нужным
  // контролом. Отдельной общей плашки больше нет — она была причиной
  // дефекта: одно сообщение красило оба поля сразу, а ошибку про тему
  // скринридер на `<Input>` не объявлял (MEMORY.md §18, п. «ошибка поля
  // связывается FieldError через id + aria-describedby»).
  const [fieldError, setFieldError] = useState<SupportFieldError | null>(null);
  const errorFor = (field: SupportField) =>
    fieldError?.field === field ? fieldError.message : undefined;
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос.
  const submitGuard = useRef(false);

  const submit = () => {
    if (create.isPending || submitGuard.current) return;
    const validationError = validateSupportForm(subject, text);
    if (validationError) {
      setFieldError(validationError);
      return;
    }
    setFieldError(null);
    submitGuard.current = true;
    const onCommitted = captureSubmission();
    create.mutate({ ...normalizeSupportForm(subject, text), onCommitted }, {
      onSettled: () => {
        submitGuard.current = false;
      },
      onSuccess: () => {
        if (!onCommitted()) return;
        haptic.success();
        toast.show({
          text: "Обращение отправлено!",
          description: "Служба поддержки свяжется с вами в Telegram",
        });
        onSubmitted?.();
      },
    });
  };

  const canSubmit =
    subject.trim().length > 0 && text.trim().length > 0 && !create.isPending;

  return (
    <>
      <MutationError error={create.error} />
      <Field label="Тема" id="support-subject" error={errorFor("subject")}>
        {(field) => (
          <Input
            {...field}
            before={<MessageSquareText size={16} className={HINT} />}
            placeholder="Например: не приходит уведомление"
            value={subject}
            maxLength={FEEDBACK_SUBJECT_MAX_LENGTH}
            status={errorFor("subject") ? "error" : undefined}
            onChange={(event) => {
              const subject = event.target.value;
              setForm((current) => ({ ...current, subject }));
              // Гасим ТОЛЬКО свою ошибку: правка соседнего поля не должна
              // снимать сообщение, которое всё ещё верно.
              if (fieldError?.field === "subject") setFieldError(null);
            }}
          />
        )}
      </Field>
      <Field label="Сообщение" id="support-text" error={errorFor("text")}>
        {(field) => (
          <Textarea
            {...field}
            rows={4}
            maxLength={FEEDBACK_TEXT_MAX_LENGTH}
            placeholder="Расскажите подробнее, что произошло"
            value={text}
            status={errorFor("text") ? "error" : undefined}
            onChange={(event) => {
              const text = event.target.value;
              setForm((current) => ({ ...current, text }));
              if (fieldError?.field === "text") setFieldError(null);
            }}
          />
        )}
      </Field>
      {text.length > 0 && (
        <CharCounter value={text.length} max={FEEDBACK_TEXT_MAX_LENGTH} />
      )}
      <Button
        stretched
        size="l"
        variant="primary"
        before={<Send size={16} />}
        loading={create.isPending}
        disabled={!canSubmit}
        onClick={submit}
      >
        Отправить
      </Button>
    </>
  );
}
