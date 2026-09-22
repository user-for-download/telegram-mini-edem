import { memo, useCallback, useRef, useState } from "react";
import {
  Accordion,
  Button,
  Caption,
  Input,
  Modal,
  Placeholder,
  Subheadline,
  Text,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { MessageSquareText, Send } from "lucide-react";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
  type UserFeedbackDto,
} from "@edem/contracts";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { AppealForm } from "@/components/AppealForm";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
// SUPPORT_FAQ — единственный источник правды в SupportPage (формулировки
// порта SupportPanel из mini-app); здесь только реэкспортный импорт,
// PageHeader страницы в модалку не тянем.
import { SUPPORT_FAQ } from "@/pages/Support/SupportPage";
import {
  useCreateFeedbackMutation,
  useMyFeedbacksQuery,
} from "@/queries/useSupportQuery";
import {
  feedbackErrorMessage,
  normalizeSupportForm,
  validateSupportForm,
} from "@/pages/Support/supportValidation";
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import styles from "./ProfileModals.module.css";

const FeedbackCard = memo(function FeedbackCard({
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
          <Caption className={styles.hint}>
            {new Date(feedback.createdAt).toLocaleDateString("ru-RU")}
          </Caption>
          <Text
            Component="p"
            className={styles.proseText}
          >
            {feedback.text}
          </Text>
          {feedback.reply ? (
            <>
              <Subheadline
                weight="2"
                Component="span"
                className={styles.replyTitle}
              >
                Ответ поддержки
              </Subheadline>
              <Text
                Component="p"
                className={styles.proseText}
              >
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
});

/**
 * Помощь и поддержка — route-backed шторка поверх «Профиля»; роут /profile/support остаётся источником правды ради диплинков
 * START_PARAM_ROUTES, точки входа FeedbackModal:152 (тот же
 * navigate("/profile/support")) и нотификаций feedback_replied →
 * notificationRoute из NotificationsPage).
 *
 * a11y: route-вариант — role=dialog + aria-modal, Esc, focus-trap,
 * таргеты ≥44px (кнопки — min-h, счётчик — aria-live, ошибки — role=alert);
 * state-вариант — telegram-ui Modal (role=dialog, Esc через onOpenChange).
 */
export function SupportModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Имя диалога для скринридера + видимый заголовок на base-платформе
  // (tgui Modal.Header рисует текст только на iOS).
  const titleId = useSheetTitleId();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Поддержка</Modal.Header>}
      aria-labelledby={titleId}
    >
      <div className={styles.sheetBody}>
        <SheetTitle titleId={titleId}>Поддержка</SheetTitle>
        <SupportBody />
      </div>
    </Modal>
  );
}

/**
 * Роут /profile/support: фон — «Профиль» (скрыт для будущей шторки),
 * поверх — inline-диалог (SSR-friendly: Modal — портал и в renderToString
 * не попадает). Закрытие — назад по истории (native Back обрабатывает Shell
 * через handleModalBack + navigate(-1)), иначе fallback на /profile.
 * Путь, START_PARAM_ROUTES и notificationRoute (feedback_replied →
 * /profile/support) не меняются.
 */
export function SupportRoute() {
  const navigate = useNavigate();
  const close = useCallback(() => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  }, [navigate]);
  return (
    <>
      <div aria-hidden hidden>
        <ProfilePage />
      </div>
      <SupportModal open onClose={close} />
    </>
  );
}

/**
 * Тело поддержки (экспортировано для SSR-тестов: Modal — портал, в
 * renderToString не попадает). Мемоизировано (тяжёлый список обращений +
 * FAQ). Без PageHeader — закрытие через header модалки / Esc / Back.
 *
 * Порт SupportPage: реальный FAQ, форма обратной связи (POST /feedback,
 * лимиты из контракта), «Мои обращения» (GET /feedback), обжалование
 * блокировки через публичный POST /feedback/appeal с raw initData.
 */
export const SupportBody = memo(function SupportBody() {
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
  // PageHeader нет — закрытие через header модалки.
  if (
    myFeedbacks.error instanceof ApiError &&
    myFeedbacks.error.status === 403
  ) {
    return (
      <>
        <Placeholder
          header="Аккаунт заблокирован"
          description="Доступ к обращениям закрыт, но вы можете обжаловать блокировку ниже — обращение уйдёт в поддержку без входа в аккаунт."
        />
        <div className={styles.stack}>
          <div className={styles.card}>
            <Subheadline
              weight="2"
              Component="span"
              className={styles.cardTitle}
            >
              Обжалование блокировки
            </Subheadline>
            <AppealForm />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className={styles.stack}>
      <section
        aria-label="Частые вопросы"
        className={styles.cardTight}
      >
        <Subheadline
          weight="2"
          Component="span"
          className={styles.cardTitle}
        >
          Частые вопросы
        </Subheadline>
        {SUPPORT_FAQ.map((item) => {
          const isOpen = openedFaqId === item.id;
          return (
            <Accordion
              key={item.id}
              expanded={isOpen}
              onChange={(expanded) => setOpenedFaqId(expanded ? item.id : null)}
            >
              <Accordion.Summary Component="button">
                {item.question}
              </Accordion.Summary>
              <Accordion.Content>
                <Text
                  Component="p"
                  className={styles.hintProse}
                >
                  {item.answer}
                </Text>
              </Accordion.Content>
            </Accordion>
          );
        })}
      </section>

      <section
        aria-label="Мои обращения"
        className={styles.card}
      >
        <Subheadline
          weight="2"
          Component="span"
          className={styles.cardTitle}
        >
          Мои обращения
        </Subheadline>
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
            <div
              className={styles.listTight}
              aria-live="polite"
              aria-label="Список обращений"
            >
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
      </section>

      <section
        aria-label="Связаться с нами"
        className={styles.card}
      >
        <Subheadline
          weight="2"
          Component="span"
          className={styles.cardTitle}
        >
          Связаться с нами
        </Subheadline>
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
                className={styles.hint}
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
          <Text Component="p" role="status" className={styles.successText}>
            Обращение отправлено — мы ответим вам как можно скорее
          </Text>
        )}
        <Button
          mode="bezeled"
          stretched
          size="l"
          className="min-h-11"
          before={<Send size={16} />}
          loading={create.isPending}
          disabled={!canSubmit}
          onClick={submit}
        >
          Отправить
        </Button>
      </section>

      <section
        aria-label="Обжалование блокировки"
        className={styles.card}
      >
        <Subheadline
          weight="2"
          Component="span"
          className={styles.cardTitle}
        >
          Обжалование блокировки
        </Subheadline>
        <AppealForm />
      </section>
    </div>
  );
});
