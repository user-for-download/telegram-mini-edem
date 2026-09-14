import { useState, type FormEvent } from "react";
import { Button, Modal, Select, Textarea } from "@telegram-apps/telegram-ui";
import { Send } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/components/ToastProvider";
import { useCreateFeedbackMutation } from "@/queries/useSupportQuery";
import {
  normalizeSupportForm,
  validateSupportForm,
} from "@/pages/supportValidation";
import { FEEDBACK_TEXT_MAX_LENGTH } from "@edem/contracts";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";

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
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Служба поддержки</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10">
        <FeedbackForm onClose={onClose} />
      </div>
    </Modal>
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

  const submit = (event: FormEvent) => {
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
    <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="text-xs text-(--tgui--hint_color)">
          Если у вас возникли сложности с бронированием или поездкой, опишите
          ситуацию. Наша команда поддержки оперативно поможет вам.
        </div>

        <div className="FormField">
          <label htmlFor="feedback-topic">Тема обращения</label>
          <Select
            id="feedback-topic"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          >
            {TOPICS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </div>

        <div className="FormField">
          <label htmlFor="feedback-text">Текст сообщения</label>
          <Textarea
            id="feedback-text"
            rows={4}
            maxLength={FEEDBACK_TEXT_MAX_LENGTH}
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              if (formError) setFormError(null);
            }}
            placeholder="Опишите детали вашего обращения..."
          />
        </div>

        {formError && (
          <p className="FormError" role="alert">
            {formError}
          </p>
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
