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
import { Button } from "@/ui/Button";
import { CharCounter } from "@/ui/CharCounter";
import { HINT } from "@/ui/classes";
import { Field } from "@/ui/Field";
import { Notice } from "@/ui/Notice";
import { haptic } from "@/utils/haptics";
import { normalizeSupportForm, validateSupportForm } from "./supportValidation";

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
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос.
  const submitGuard = useRef(false);

  const submit = () => {
    if (create.isPending || submitGuard.current) return;
    const validationError = validateSupportForm(subject, text);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    submitGuard.current = true;
    create.mutate(normalizeSupportForm(subject, text), {
      onSettled: () => {
        submitGuard.current = false;
      },
      onSuccess: () => {
        haptic.success();
        toast.show({
          text: "Обращение отправлено!",
          description: "Служба поддержки свяжется с вами в Telegram",
        });
        setSubject("");
        setText("");
        onSubmitted?.();
      },
    });
  };

  const canSubmit =
    subject.trim().length > 0 && text.trim().length > 0 && !create.isPending;

  return (
    <>
      <MutationError error={create.error} />
      <Field label="Тема" id="support-subject">
        {(field) => (
          <Input
            {...field}
            before={<MessageSquareText size={16} className={HINT} />}
            placeholder="Например: не приходит уведомление"
            value={subject}
            maxLength={FEEDBACK_SUBJECT_MAX_LENGTH}
            status={formError ? "error" : undefined}
            onChange={(event) => {
              setSubject(event.target.value);
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      <Field label="Сообщение" id="support-text">
        {(field) => (
          <Textarea
            {...field}
            rows={4}
            maxLength={FEEDBACK_TEXT_MAX_LENGTH}
            placeholder="Расскажите подробнее, что произошло"
            value={text}
            aria-invalid={Boolean(formError)}
            status={formError ? "error" : undefined}
            onChange={(event) => {
              setText(event.target.value);
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      {text.length > 0 && (
        <CharCounter value={text.length} max={FEEDBACK_TEXT_MAX_LENGTH} />
      )}
      {formError && (
        <Notice tone="danger" variant="text">
          {formError}
        </Notice>
      )}
      <Button
        stretched
        size="l"
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