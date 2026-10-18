import { memo, useState } from "react";
import {
  Accordion,
  Caption,
  Info,
  VisuallyHidden,
} from "@telegram-apps/telegram-ui";
import { Section } from "@/ui/Section";
import { AS_BUTTON_FLAT } from "@/ui/classes";
import { PROSE } from "@/ui/classes";
import { Cell } from "@/ui/Cell";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Button } from "@/ui/Button";

import { ChevronRight, PlusCircle } from "lucide-react";
import { type UserFeedbackDto } from "@edem/contracts";
import { QueryState } from "@/components/QueryState";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { AppealForm } from "@/components/AppealForm";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { ApiError } from "@/api/client";
import { moscowNumericDate } from "@/utils/date";
import { useMyFeedbacksQuery } from "@/queries/useSupportQuery";
import { useModalBack } from "@/utils/modalBack";
import { haptic } from "@/utils/haptics";
import { FeedbackModal } from "./FeedbackModal";
import { FeedbackDetailsModal } from "./FeedbackDetailsModal";
import {
  feedbackCellAriaLabel,
  feedbackPreviewSubtitle,
  feedbackStatus,
} from "./feedbackPreview";
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

/**
 * Строка обращения — как строка жалобы и уведомления: короткий `Cell`
 * (тема / начало текста / статус) с датой и шевроном в правой колонке.
 *
 * Полный текст обращения и ответ поддержки раздавали ленту, поэтому уехали в
 * попап (`FeedbackDetailsModal`). Статус виден и в списке — по нему понятно,
 * на что уже ответили, без раскрытия каждой строки.
 *
 * Строка всегда интерактивна (тап открывает попап), поэтому нативная кнопка
 * `Component="button"` — свой `onKeyDown` не нужен, Enter/Space сработают сами.
 */
const FeedbackCell = memo(function FeedbackCell({
  feedback,
  onOpen,
}: {
  feedback: UserFeedbackDto;
  onOpen: (id: string) => void;
}) {
  const status = feedbackStatus(feedback);
  return (
    <Cell
      Component="button"
      type="button"
      className={styles.cell}
      subtitle={feedbackPreviewSubtitle(feedback)}
      /* Строка 3 — статус: та же трёхстрочная раскладка, что у жалоб и
         уведомлений. Текстом, а не пилюлей: в правой колонке уже дата, и
         второй «остров» тянул бы строку в две части. Смысл всегда продублирован
         словами, цвет — только подсказка (a11y: color + text). */
      description={
        <span
          data-testid={`feedback-status-${feedback.id}`}
          data-tone={status.tone}
          className={styles.status}
        >
          {status.label}
        </span>
      }
      after={
        <Info
          type="text"
          className={styles.info}
          subtitle={moscowNumericDate(feedback.createdAt)}
        >
          <ChevronRight size={16} className={styles.chevron} aria-hidden />
        </Info>
      }
      aria-label={feedbackCellAriaLabel(feedback)}
      data-testid={`feedback-cell-${feedback.id}`}
      onClick={() => {
        haptic.light();
        onOpen(feedback.id);
      }}
    >
      {feedback.subject}
    </Cell>
  );
});

/**
 * Поддержка Telegram-приложения — единственный экран поддержки (пункт меню
 * профиля ведёт сюда; раньше он открывал шторку с дублем формы, которая сама
 * вела на эту страницу):
 * - реальный FAQ (первым: чаще всего вопрос решается справкой);
 * - «Мои обращения» строками `Cell` (как жалобы и уведомления): тема, начало
 *   текста, статус и дата; полный текст и ответ поддержки — в попапе по тапу;
 * - форма обращения (POST /feedback, лимиты 100/2000 из контракта) — из окна
 *   `FeedbackModal`, с подтверждением тостом — общий язык приложения.
 *
 * Жалобы на пользователя — НЕ здесь: у них отдельная страница
 * /profile/reports (один путь вместо двух).
 *
 * Форма обжалования блокировки в обычном состоянии тоже нет: она бессмысленна
 * без бана и занимала целый экран. Она живёт там, где бан и есть, — на
 * терминальном экране (`AccountStatePage`, как в AuthGate и ReportsPage) —
 * и в ветке 403 ниже для бана, случившегося на этой странице (requireUser
 * отвечает 403).
 */
export function SupportPage() {
  const [openedFaqId, setOpenedFaqId] = useState<string | null>(null);
  // Открытое обращение держим по id, а не самим объектом: после инвалидации
  // кэша (пришёл ответ) попап должен перерисоваться по новым данным.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Форма обращения — во всплывающем окне (FeedbackModal): нажал
  // «Создать обращение» под списком, Back закрывает через useModalBack.
  const [createOpen, setCreateOpen] = useState(false);
  useModalBack(() => setCreateOpen(false), createOpen);
  // Подписка на Back для попапа идёт ПОСЛЕ формы: стек LIFO, и при открытых
  // обоих окнах верхним должен закрываться попап — последний, кто подписался.
  useModalBack(() => setSelectedId(null), selectedId !== null);

  const myFeedbacks = useMyFeedbacksQuery();
  const selected =
    myFeedbacks.data?.find((feedback) => feedback.id === selectedId) ?? null;

  // Бан mid-session: requireUser отвечает 403 — терминальный экран плюс
  // рабочая форма обжалования (публичный appeal с initData). Токен в
  // apiClient при этом ещё валиден (бан не логаут, а emitBanned живёт только
  // в performRefresh), поэтому канал апелляции задан в хуке формы явно, а не
  // выведен из токена. AccountStatePage — тот же канон, что на экране бана
  // (AuthGate) и в жалобах (ReportsPage): раньше здесь был самодельный
  // EmptyState, и терминальные экраны выглядели в приложении по-разному.
  if (
    myFeedbacks.error instanceof ApiError &&
    myFeedbacks.error.status === 403
  ) {
    return (
      <AccountStatePage
        title="Аккаунт заблокирован"
        description="Доступ к обращениям закрыт, но вы можете обжаловать блокировку ниже — обращение уйдёт в поддержку без входа в аккаунт."
      >
        {/* Секция внутри AccountStatePage намеренно: вне его гуттера
            секция встаёт во всю ширину (0px) — другая рамка, чем у всех
            остальных секций приложения. */}
        <Section header="Обжалование блокировки">
          <SectionBody>
            <AppealForm />
          </SectionBody>
        </Section>
      </AccountStatePage>
    );
  }

  return (
    <>
      <Page>
        {/* NavHeader помечен aria-hidden («авторитетные h1 живут на
            страницах»), а заголовки секций фасад отдаёт как h2 — имя экрана
            даёт скрытый h1. */}
        <VisuallyHidden Component="h1">Поддержка</VisuallyHidden>
        <Section header="Частые вопросы">
          <SectionBody>
            {/* Список без зазора: кит рисует разделитель между соседними
                строками, а Accordion не даёт своей DOM-обёртки — без общего
                контейнера ритм секции расставлял бы Summary и Content врозь и
                вопросы «плавали» по одному. */}
            <div className={styles.list}>
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
                    <Accordion.Summary
                      multiline
                      Component="button"
                      className={AS_BUTTON_FLAT}
                    >
                      {item.question}
                    </Accordion.Summary>
                    <Accordion.Content>
                      <Caption Component="p" className={PROSE}>
                        {item.answer}
                      </Caption>
                    </Accordion.Content>
                  </Accordion>
                );
              })}
            </div>
          </SectionBody>
        </Section>

        <Section header="Мои обращения">
          <SectionBody>
            <QueryState
              loading={myFeedbacks.isLoading}
              error={myFeedbacks.error}
              empty={false}
              emptyText=""
              onRetry={() => void myFeedbacks.refetch()}
            >
              {!myFeedbacks.data || myFeedbacks.data.length === 0 ? (
                <EmptyState
                  header={EMPTY_STATES.supportEmpty.header}
                  description={EMPTY_STATES.supportEmpty.description}
                />
              ) : (
                <div className={styles.list}>
                  {myFeedbacks.data.map((feedback) => (
                    <FeedbackCell
                      key={feedback.id}
                      feedback={feedback}
                      onOpen={setSelectedId}
                    />
                  ))}
                </div>
              )}
            </QueryState>
            {/* Написать новое обращение — из окна: сама страница отвечает за
                FAQ и историю, а форма на весь экран занимала бы его
                целиком. */}
            <Button
              stretched
              size="m"
              variant="primary"
              before={<PlusCircle size={16} />}
              onClick={() => {
                haptic.light();
                setCreateOpen(true);
              }}
            >
              Создать обращение
            </Button>
          </SectionBody>
        </Section>
      </Page>
      <FeedbackDetailsModal
        feedback={selected}
        onClose={() => setSelectedId(null)}
      />
      <FeedbackModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
