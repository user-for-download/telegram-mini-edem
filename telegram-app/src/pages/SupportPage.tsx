import { useRef, useState } from "react";
import {
  Accordion,
  Button,
  Input,
  Placeholder,
  Section,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { MessageSquareText, Send } from "lucide-react";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
  type UserFeedbackDto,
} from "@edem/contracts";
import { PageHeader } from "@/components/PageHeader";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { AppealForm } from "@/components/AppealForm";
import { ApiError } from "@/api/client";
import {
  useCreateFeedbackMutation,
  useMyFeedbacksQuery,
} from "@/queries/useSupportQuery";
import {
  feedbackErrorMessage,
  normalizeSupportForm,
  validateSupportForm,
} from "@/pages/supportValidation";

/**
 * FAQ поддержки (порт SupportPanel из mini-app): формулировки сохранены,
 * пункт про подтверждение личности адаптирован — вместо данных профиля
 * ВКонтакте используется профиль Telegram.
 */
export const SUPPORT_FAQ: ReadonlyArray<{
  id: string;
  question: string;
  answer: string;
}> = [
  {
    id: "how-to-book",
    question: "Как забронировать место?",
    answer:
      "Откройте поездку, выберите свободное место, добавьте комментарий водителю и нажмите «Отправить заявку». После этого водитель сможет подтвердить или отклонить заявку.",
  },
  {
    id: "how-to-cancel",
    question: "Как отменить бронь?",
    answer:
      "Откройте раздел «Мои брони», найдите нужную поездку и нажмите «Отменить заявку», если отмена еще доступна для этой поездки.",
  },
  {
    id: "how-to-review",
    question: "Как оставить отзыв?",
    answer:
      "После завершения поездки в истории поездок появится кнопка «Оставить отзыв». Выберите оценку и добавьте комментарий.",
  },
  {
    id: "driver-not-confirmed",
    question: "Что делать, если водитель долго не подтверждает заявку?",
    answer:
      "Заявка может оставаться в статусе ожидания до решения водителя. Если поездка скоро, попробуйте выбрать другой вариант или написать водителю через поддержку.",
  },
  {
    id: "safety",
    question: "Как работает подтверждение личности?",
    answer:
      "Мы используем данные профиля Telegram и дополнительные проверки для водителей. Подтвержденный профиль повышает доверие к пользователю.",
  },
];

function FeedbackCard({
  feedback,
  opened,
  onToggle,
}: {
  feedback: UserFeedbackDto;
  opened: boolean;
  onToggle: () => void;
}) {
  return (
    <Accordion expanded={opened} onChange={onToggle}>
      <Accordion.Summary Component="button">
        {feedback.subject}
        {feedback.reply && (
          <span className="StatusPill" data-tone="info">
            Есть ответ
          </span>
        )}
      </Accordion.Summary>
      <Accordion.Content>
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-(--tgui--hint_color)">
            {new Date(feedback.createdAt).toLocaleDateString("ru-RU")}
          </span>
          <p className="text-[13px] text-(--tgui--text_color) leading-relaxed">
            {feedback.text}
          </p>
          {feedback.reply ? (
            <>
              <span className="text-[13px] font-semibold text-(--tgui--text_color) pt-1">
                Ответ поддержки
              </span>
              <p className="text-[13px] text-(--tgui--text_color) leading-relaxed">
                {feedback.reply}
              </p>
            </>
          ) : (
            <span className="text-[12px] text-(--tgui--hint_color)">
              Поддержка ещё не ответила. Мы свяжемся с вами здесь — список
              обновится автоматически.
            </span>
          )}
        </div>
      </Accordion.Content>
    </Accordion>
  );
}

/**
 * Помощь и поддержка Telegram-приложения (порт VK SupportPanel):
 * - реальный FAQ;
 * - форма обратной связи (POST /feedback, лимиты 100/2000 из контракта);
 * - «Мои обращения» со статусом ответа (GET /feedback);
 * - обжалование блокировки — рабочая форма через публичный
 *   POST /feedback/appeal с raw initData (TG-ветка backend, без токена).
 */
export function SupportPage() {
  const [openedFaqId, setOpenedFaqId] = useState<string | null>(null);
  const [openedFeedbackId, setOpenedFeedbackId] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [text, setText] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // Защита от двойного сабмита: ref синхронен (в отличие от state),
  // второй клик до ре-рендера не отправит второй запрос (паттерн VK).
  const submitGuard = useRef(false);

  const myFeedbacks = useMyFeedbacksQuery();
  const create = useCreateFeedbackMutation();

  const submit = () => {
    if (create.isPending || submitGuard.current) return;
    const validationError = validateSupportForm(subject, text);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    setSuccess(false);
    submitGuard.current = true;
    create.mutate(normalizeSupportForm(subject, text), {
      onSettled: () => {
        submitGuard.current = false;
      },
      onSuccess: () => {
        setSubject("");
        setText("");
        setSuccess(true);
      },
      onError: (error) => setFormError(feedbackErrorMessage(error)),
    });
  };

  const canSubmit =
    subject.trim().length > 0 && text.trim().length > 0 && !create.isPending;

  // Бан mid-session: requireUser отвечает 403 — терминальный экран плюс
  // рабочая форма обжалования (публичный appeal с initData, без токена).
  if (myFeedbacks.error instanceof ApiError && myFeedbacks.error.status === 403) {
    return (
      <>
        <PageHeader title="Поддержка" />
        <Placeholder
          header="Аккаунт заблокирован"
          description="Доступ к обращениям закрыт, но вы можете обжаловать блокировку ниже — обращение уйдёт в поддержку без входа в аккаунт."
        />
        <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
      <Section header="Обжалование блокировки">
        <div className="flex flex-col gap-3 p-4">
          <AppealForm />
        </div>
      </Section>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Поддержка" />

      <div className="flex flex-col gap-3.5 px-4 pt-1 pb-24">
      <Section header="Частые вопросы">
        <div className="flex flex-col gap-2 p-4">
        {SUPPORT_FAQ.map((item) => {
          const isOpen = openedFaqId === item.id;
          return (
            <Accordion
              key={item.id}
              expanded={isOpen}
              onChange={(expanded) => setOpenedFaqId(expanded ? item.id : null)}
            >
              <Accordion.Summary Component="button">{item.question}</Accordion.Summary>
              <Accordion.Content>
                <p className="text-[13px] text-(--tgui--hint_color) leading-relaxed">
                  {item.answer}
                </p>
              </Accordion.Content>
            </Accordion>
          );
        })}
        </div>
      </Section>

      <Section header="Мои обращения">
        <div className="flex flex-col gap-3 p-4">
        <QueryState
          loading={myFeedbacks.isLoading}
          error={myFeedbacks.error}
          empty={false}
          emptyText=""
          onRetry={() => void myFeedbacks.refetch()}
        >
          {!myFeedbacks.data || myFeedbacks.data.length === 0 ? (
            <>
              <p className="text-[14px] font-semibold text-center text-(--tgui--text_color)">
                У вас пока нет обращений
              </p>
              <p className="text-[13px] text-center text-(--tgui--hint_color)">
                Здесь появятся ваши обращения и ответы поддержки
              </p>
            </>
          ) : (
            <div className="flex flex-col gap-2">
              {myFeedbacks.data.map((feedback) => (
                <FeedbackCard
                  key={feedback.id}
                  feedback={feedback}
                  opened={openedFeedbackId === feedback.id}
                  onToggle={() =>
                    setOpenedFeedbackId(
                      openedFeedbackId === feedback.id ? null : feedback.id,
                    )
                  }
                />
              ))}
            </div>
          )}
        </QueryState>
        </div>
      </Section>

      <Section header="Связаться с нами" aria-label="Связаться с нами">
        <div className="flex flex-col gap-3 p-4">
          <MutationError error={create.error} />
          <div className="FormField">
            <label htmlFor="support-subject">Тема</label>
            <Input
              id="support-subject"
              before={<MessageSquareText size={16} className="text-(--tgui--hint_color)" />}
              placeholder="Например: не приходит уведомление"
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
            <label htmlFor="support-text">Сообщение</label>
            <Textarea
              id="support-text"
              rows={4}
              maxLength={FEEDBACK_TEXT_MAX_LENGTH}
              placeholder="Расскажите подробнее, что произошло"
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
              Обращение отправлено — мы ответим вам как можно скорее
            </p>
          )}
          <Button mode="bezeled"
            stretched
            size="l"
            before={<Send size={16} />}
            loading={create.isPending}
            disabled={!canSubmit}
            onClick={submit}
          >
            Отправить
          </Button>
        </div>
      </Section>

      <Section header="Обжалование блокировки">
        <div className="flex flex-col gap-3 p-4">
          <AppealForm />
        </div>
      </Section>
      </div>
    </>
  );
}
