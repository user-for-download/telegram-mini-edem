import { useState, type SubmitEvent } from "react";
import { Button, Caption, Select, Textarea } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/Toast/ToastProvider";
import { useCreateFeedbackMutation } from "@/queries/useSupportQuery";
import {
  normalizeSupportForm,
  validateSupportForm,
} from "@/pages/Support/supportValidation";
import { FEEDBACK_TEXT_MAX_LENGTH } from "@edem/contracts";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import styles from "./ProfileModals.module.css";

const TOPICS = [
  "Вопрос по поездке",
  "Вопрос по оплате",
  "Техническая ошибка",
  "Жалоба на водителя/пассажира",
  "Предложение по улучшению",
] as const;

/**
 * Быстрое обращение в поддержку — модальная шторка (модель FeedbackModal
 * примера: в Telegram нет «новых страниц» для форм). Тема — фиксированный
 * список (subject), текст — до лимита контракта. История обращений и FAQ
 * живут на странице /profile/support (ссылка «Мои обращения» внутри).
 */
export function FeedbackModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Имя диалога для скринридера + видимый заголовок на base-платформе
  // (tgui Modal.Header рисует текст только на iOS).
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Служба поддержки"
      variant="static"
    >
      <FeedbackForm onClose={onClose} />
    </Sheet>
  );
}

/** Тело формы (экспортировано для SSR-тестов: Modal — портал, в renderToString не попадает). */
export function FeedbackForm({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateFeedbackMutation();
  const [topic, setTopic] = useState<string>(TOPICS[0]);
  const [message, setMessage] = useState("");
  useClosingConfirmation(message !== "");
  const [formError, setFormError] = useState<string | null>(null);

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const error = validateSupportForm(topic, message);
    if (error) {
      haptic.error();
      setFormError(error);
      return;
    }
    setFormError(null);
    create.mutate(normalizeSupportForm(topic, message), {
      onSuccess: () => {
        haptic.success();
        toast.show({
          text: "Обращение отправлено!",
          description: "Служба поддержки свяжется с вами в Telegram",
        });
        setMessage("");
        onClose();
      },
      onError: (mutationError) => {
        haptic.error();
        setFormError(
          mutationError instanceof Error
            ? mutationError.message
            : "Не удалось отправить обращение",
        );
      },
    });
  };

  return (
    <form onSubmit={submit} className={styles.form}>
      <Caption Component="div">
        Если у вас возникли сложности с бронированием или поездкой, опишите
        ситуацию. Наша команда поддержки оперативно поможет вам.
      </Caption>

      <Field label="Тема обращения" id="feedback-topic">
        {(field) => (
          <Select
            {...field}
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          >
            {TOPICS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Текст сообщения" id="feedback-text">
        {(field) => (
          <Textarea
            {...field}
            rows={4}
            maxLength={FEEDBACK_TEXT_MAX_LENGTH}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (formError) setFormError(null);
            }}
            placeholder="Опишите детали вашего обращения..."
          />
        )}
      </Field>

      {formError && (
        <Notice tone="danger" variant="text">
          {formError}
        </Notice>
      )}

      <Button
        size="l"
        mode="bezeled"
        stretched
        type="submit"
        loading={create.isPending}
        disabled={create.isPending || message.trim().length === 0}
        before={<Send size={16} />}
      >
        Отправить в поддержку
      </Button>

      <Button
        size="m"
        mode="bezeled"
        stretched
        type="button"
        onClick={() => {
          haptic.light();
          onClose();
          navigate("/profile/support");
        }}
      >
        Мои обращения
      </Button>
    </form>
  );
}
