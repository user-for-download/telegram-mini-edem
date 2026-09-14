import { useRef, useState } from "react";
import { Button, Input, Textarea } from "@telegram-apps/telegram-ui";
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
} from "@/pages/supportValidation";

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
  // второй клик до ре-рендера не отправит второй запрос (паттерн VK).
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
      <div className="FormField">
        <label htmlFor="appeal-subject">Тема</label>
        <Input
          id="appeal-subject"
          before={<MessageSquareText size={16} className="text-(--tgui--hint_color)" />}
          value={subject}
          maxLength={FEEDBACK_SUBJECT_MAX_LENGTH}
          status={formError ? "error" : "default"}
          onChange={(event) => {
            setSubject(event.target.value);
            if (formError) setFormError(null);
            if (success) setSuccess(false);
          }}
        />
      </div>
      <div className="FormField">
        <label htmlFor="appeal-text">Сообщение</label>
        <Textarea
          id="appeal-text"
          rows={4}
          maxLength={FEEDBACK_TEXT_MAX_LENGTH}
          placeholder="Почему блокировка ошибочна и что просите пересмотреть"
          value={text}
          aria-invalid={Boolean(formError)}
          status={formError ? "error" : "default"}
          onChange={(event) => {
            setText(event.target.value);
            if (formError) setFormError(null);
            if (success) setSuccess(false);
          }}
        />
      </div>
      {text.length > 0 && (
        <p className="ReviewCounter" aria-live="polite">
          {text.length}/{FEEDBACK_TEXT_MAX_LENGTH}
        </p>
      )}
      {formError && (
        <p className="FormError" role="alert">
          {formError}
        </p>
      )}
      {success && (
        <p className="ReviewSuccess" role="status">
          Обращение отправлено — администрация рассмотрит его как можно скорее
        </p>
      )}
      <div className="ButtonRow">
        <Button mode="bezeled"
          stretched
          size="l"
          before={<Send size={16} />}
          loading={appeal.isPending}
          disabled={!canSubmit}
          onClick={submit}
        >
          Отправить обжалование
        </Button>
      </div>
    </>
  );
}
