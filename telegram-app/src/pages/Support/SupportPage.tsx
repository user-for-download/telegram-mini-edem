import { useRef, useState } from "react";
import {
  Accordion,
  Button,
  Caption,
  Input,
  Placeholder,
  Section,
  Text,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { MessageSquareText, Send } from "lucide-react";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
  type UserFeedbackDto,
} from "@edem/contracts";
import { PageHeader } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill/StatusPill";
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
} from "./supportValidation";
import styles from "./SupportPage.module.css";

/**
 * FAQ поддержки: формулировки сохранены, личность подтверждается
 * профилем Telegram.
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
        {feedback.reply && <StatusPill tone="info">Есть ответ</StatusPill>}
      </Accordion.Summary>
      <Accordion.Content>
        <div className={styles.cardBody}>
          <Caption Component="span">
            {new Date(feedback.createdAt).toLocaleDateString("ru-RU")}
          </Caption>
          <Text Component="p" className={styles.prose}>
            {feedback.text}
          </Text>
          {feedback.reply ? (
            <>
              <Text weight="2" Component="span" className={styles.replyTitle}>
                Ответ поддержки
              </Text>
              <Text Component="p" className={styles.prose}>
                {feedback.reply}
              </Text>
            </>
          ) : (
            <Caption Component="span">
              Поддержка ещё не ответила. Мы свяжемся с вами здесь — список
              обновится автоматически.
            </Caption>
          )}
        </div>
      </Accordion.Content>
    </Accordion>
  );
}

/**
 * Помощь и поддержка Telegram-приложения:
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
  // второй клик до ре-рендера не отправит второй запрос (защита от двойного сабмита).
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
  if (
    myFeedbacks.error instanceof ApiError &&
    myFeedbacks.error.status === 403
  ) {
    return (
      <>
        <PageHeader title="Поддержка" />
        <Placeholder
          header="Аккаунт заблокирован"
          description="Доступ к обращениям закрыт, но вы можете обжаловать блокировку ниже — обращение уйдёт в поддержку без входа в аккаунт."
        />
        <div className={styles.wrap}>
          <Section header="Обжалование блокировки">
            <div className={styles.panel}>
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

      <div className={styles.wrap}>
        <Section header="Частые вопросы">
          <div className={styles.faqPanel}>
            {SUPPORT_FAQ.map((item) => {
              const isOpen = openedFaqId === item.id;
              return (
                <Accordion
                  key={item.id}
                  expanded={isOpen}
                  onChange={(expanded) =>
                    setOpenedFaqId(expanded ? item.id : null)
                  }
                >
                  <Accordion.Summary Component="button">
                    {item.question}
                  </Accordion.Summary>
                  <Accordion.Content>
                    <Caption Component="p" className={styles.prose}>
                      {item.answer}
                    </Caption>
                  </Accordion.Content>
                </Accordion>
              );
            })}
          </div>
        </Section>

        <Section header="Мои обращения">
          <div className={styles.panel}>
            <QueryState
              loading={myFeedbacks.isLoading}
              error={myFeedbacks.error}
              empty={false}
              emptyText=""
              onRetry={() => void myFeedbacks.refetch()}
            >
              {!myFeedbacks.data || myFeedbacks.data.length === 0 ? (
                <>
                  <Text weight="2" Component="p" className={styles.centerText}>
                    У вас пока нет обращений
                  </Text>
                  <Caption Component="p" className={styles.centerText}>
                    Здесь появятся ваши обращения и ответы поддержки
                  </Caption>
                </>
              ) : (
                <div className={styles.list}>
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
          <div className={styles.panel}>
            <MutationError error={create.error} />
            <div>
              <label htmlFor="support-subject" className="sr-only">
                Тема
              </label>
              <Input
                id="support-subject"
                header="Тема"
                before={
                  <MessageSquareText
                    size={16}
                    className={styles.hintIcon}
                  />
                }
                placeholder="Например: не приходит уведомление"
                value={subject}
                maxLength={FEEDBACK_SUBJECT_MAX_LENGTH}
                status={formError ? "error" : undefined}
                onChange={(event) => {
                  setSubject(event.target.value);
                  if (formError) setFormError(null);
                  if (success) setSuccess(false);
                }}
              />
            </div>
            <div>
              <label htmlFor="support-text" className="sr-only">
                Сообщение
              </label>
              <Textarea
                id="support-text"
                header="Сообщение"
                rows={4}
                maxLength={FEEDBACK_TEXT_MAX_LENGTH}
                placeholder="Расскажите подробнее, что произошло"
                value={text}
                aria-invalid={Boolean(formError)}
                status={formError ? "error" : undefined}
                onChange={(event) => {
                  setText(event.target.value);
                  if (formError) setFormError(null);
                  if (success) setSuccess(false);
                }}
              />
            </div>
            {text.length > 0 && (
              <Caption Component="p" className={styles.counter} aria-live="polite">
                {text.length}/{FEEDBACK_TEXT_MAX_LENGTH}
              </Caption>
            )}
            {formError && (
              <Caption
                Component="p"
                role="alert"
                className={styles.errorText}
              >
                {formError}
              </Caption>
            )}
            {success && (
              <Text
                Component="p"
                role="status"
                className={styles.successText}
              >
                Обращение отправлено — мы ответим вам как можно скорее
              </Text>
            )}
            <Button
              mode="bezeled"
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
          <div className={styles.panel}>
            <AppealForm />
          </div>
        </Section>
      </div>
    </>
  );
}
