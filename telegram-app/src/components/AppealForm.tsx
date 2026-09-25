import { useRef, useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import { Button } from "@/ui/Button";
import { Field } from "@/ui/Field";
import { CharCounter } from "@/ui/CharCounter";
import { Notice } from "@/ui/Notice";
import { HINT } from "@/ui/classes";

import { MessageSquareText, Send } from "lucide-react";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
} from "@edem/contracts";
import { useAppealFeedbackMutation } from "@/queries/useSupportQuery";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import {
  feedbackErrorMessage,
  normalizeSupportForm,
  validateSupportForm,
} from "@/pages/Support/supportValidation";

/**
 * Форма обжалования блокировки (порт FeedbackModal из mini-app для экрана
 * бана): тема предзаполнена «Обжалование блокировки», отправка — через
 * публичный POST /feedback/appeal с raw initData (без токена).
 * Используется в AuthGate (экран бана) и SupportPage (секция обжалования,
 * 403-ветка mid-session бана). Остальной UI не затрагивает.
 */
export function AppealForm() {
  const [subject, setSubject] = useState("Обжалование блокировки");
  const [text, setText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  useClosingConfirmation(text !== "");
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос (защита от двойного сабмита).
  const submitGuard = useRef(false);

  const appeal = useAppealFeedbackMutation();

  const submit = () => {
    if (appeal.isPending || submitGuard.current) return;
    const validationError = validateSupportForm(subject, text);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setSuccess(false);
    submitGuard.current = true;
    appeal.mutate(normalizeSupportForm(subject, text), {
      onSettled: () => {
        submitGuard.current = false;
      },
      onSuccess: () => {
        haptic.success();
        setText("");
        setSuccess(true);
      },
      onError: (error) => {
        haptic.error();
        setFormError(feedbackErrorMessage(error));
      },
    });
  };

  const canSubmit =
    subject.trim().length > 0 && text.trim().length > 0 && !appeal.isPending;

  return (
    <>
      <Field label="Тема" id="appeal-subject">
        {(field) => (
          <Input
            {...field}
            before={
              <MessageSquareText size={16} className={HINT} />
            }
            value={subject}
            maxLength={FEEDBACK_SUBJECT_MAX_LENGTH}
            status={formError ? "error" : undefined}
            onChange={(event) => {
              setSubject(event.target.value);
              if (formError) setFormError(null);
              if (success) setSuccess(false);
            }}
          />
        )}
      </Field>
      <Field label="Сообщение" id="appeal-text">
        {(field) => (
          <Textarea
            {...field}
            rows={4}
            maxLength={FEEDBACK_TEXT_MAX_LENGTH}
            placeholder="Почему блокировка ошибочна и что просите пересмотреть"
            value={text}
            aria-invalid={Boolean(formError)}
            status={formError ? "error" : undefined}
            onChange={(event) => {
              setText(event.target.value);
              if (formError) setFormError(null);
              if (success) setSuccess(false);
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
      {success && (
        <Notice tone="success" variant="text">
          Обращение отправлено — администрация рассмотрит его как можно скорее
        </Notice>
      )}
      <Button
        stretched
        size="l"
        before={<Send size={16} />}
        loading={appeal.isPending}
        disabled={!canSubmit}
        onClick={submit}
      >
        Отправить обжалование
      </Button>
    </>
  );
}
