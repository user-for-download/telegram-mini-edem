import {
  memo,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  Accordion,
  Button,
  Input,
  Modal,
  Placeholder,
  Textarea,
} from "@telegram-apps/telegram-ui";
import { MessageSquareText, Send, X } from "lucide-react";
import {
  FEEDBACK_SUBJECT_MAX_LENGTH,
  FEEDBACK_TEXT_MAX_LENGTH,
  type UserFeedbackDto,
} from "@edem/contracts";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { AppealForm } from "@/components/AppealForm";
import { MutationError } from "@/components/MutationError";
import { QueryState } from "@/components/QueryState";
import { ProfilePage } from "@/pages/ProfilePage";
// SUPPORT_FAQ — единственный источник правды в SupportPage (формулировки
// порта SupportPanel из mini-app); здесь только реэкспортный импорт,
// PageHeader страницы в модалку не тянем.
import { SUPPORT_FAQ } from "@/pages/SupportPage";
import {
  useCreateFeedbackMutation,
  useMyFeedbacksQuery,
} from "@/queries/useSupportQuery";
import {
  feedbackErrorMessage,
  normalizeSupportForm,
  validateSupportForm,
} from "@/pages/supportValidation";

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
});

/**
 * Помощь и поддержка — модальная шторка поверх «Профиля» (модель примера:
 * CreateTripModal/VehicleModal; в Telegram нет «новых страниц», только
 * модалки; роут /profile/support остаётся источником правды ради диплинков
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
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Поддержка</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto">
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
  // PageHeader нет — закрытие через header модалки.
  if (myFeedbacks.error instanceof ApiError && myFeedbacks.error.status === 403) {
    return (
      <>
        <Placeholder
          header="Аккаунт заблокирован"
          description="Доступ к обращениям закрыт, но вы можете обжаловать блокировку ниже — обращение уйдёт в поддержку без входа в аккаунт."
        />
        <div className="flex flex-col gap-3.5 pt-1">
          <div className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3">
            <span className="text-[13px] font-semibold text-(--tgui--text_color)">
              Обжалование блокировки
            </span>
            <AppealForm />
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <section
        aria-label="Частые вопросы"
        className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-2"
      >
        <span className="text-[13px] font-semibold text-(--tgui--text_color)">
          Частые вопросы
        </span>
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
      </section>

      <section
        aria-label="Мои обращения"
        className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3"
      >
        <span className="text-[13px] font-semibold text-(--tgui--text_color)">
          Мои обращения
        </span>
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
            <div className="flex flex-col gap-2" aria-live="polite" aria-label="Список обращений">
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
        className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3"
      >
        <span className="text-[13px] font-semibold text-(--tgui--text_color)">
          Связаться с нами
        </span>
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
        className="p-4 rounded-2xl bg-(--tgui--section_bg_color) border border-(--tgui--outline) shadow-xs flex flex-col gap-3"
      >
        <span className="text-[13px] font-semibold text-(--tgui--text_color)">
          Обжалование блокировки
        </span>
        <AppealForm />
      </section>
    </div>
  );
});
