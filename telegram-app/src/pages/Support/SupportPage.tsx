import { useState } from "react";
import { VisuallyHidden } from "@telegram-apps/telegram-ui";
import { Accordion, Caption, Text } from "@telegram-apps/telegram-ui";
import { Section } from "@/ui/Section";
import { AS_BUTTON } from "@/ui/classes";
import { PROSE } from "@/ui/classes";
import { EmptyState } from "@/ui/EmptyState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { Button } from "@/ui/Button";

import { PlusCircle } from "lucide-react";
import { type UserFeedbackDto } from "@edem/contracts";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { QueryState } from "@/components/QueryState";
import { AccountStatePage } from "@/pages/AccountStatePage/AccountStatePage";
import { AppealForm } from "@/components/AppealForm";
import { Page } from "@/ui/Page";
import { SectionBody } from "@/ui/SectionBody";
import { Stack } from "@/ui/Stack";
import { ApiError } from "@/api/client";
import { moscowNumericDate } from "@/utils/date";
import { useMyFeedbacksQuery } from "@/queries/useSupportQuery";
import { useModalBack } from "@/utils/modalBack";
import { haptic } from "@/utils/haptics";
import { FeedbackModal } from "./FeedbackModal";
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
      <Accordion.Summary Component="button" className={AS_BUTTON}>
        {feedback.subject}
        {feedback.reply && <StatusPill tone="info">Есть ответ</StatusPill>}
      </Accordion.Summary>
      <Accordion.Content>
        <div className={styles.cardBody}>
          <Caption Component="span">
            {moscowNumericDate(feedback.createdAt)}
          </Caption>
          <Text Component="p" className={PROSE}>
            {feedback.text}
          </Text>
          {feedback.reply ? (
            <>
              <Text weight="2" Component="span" className={styles.replyTitle}>
                Ответ поддержки
              </Text>
              <Text Component="p" className={PROSE}>
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
 * Поддержка Telegram-приложения — единственный экран поддержки (пункт меню
 * профиля ведёт сюда; раньше он открывал шторку с дублем формы, которая сама
 * вела на эту страницу):
 * - реальный FAQ (первым: чаще всего вопрос решается справкой);
 * - форма обращения (POST /feedback, лимиты 100/2000 из контракта) с
 *   подтверждением тостом — общий язык приложения, как при публикации
 *   поездки;
 * - «Мои обращения» со статусом ответа (GET /feedback).
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
  const [openedFeedbackId, setOpenedFeedbackId] = useState<string | null>(null);
  // Форма обращения — во всплывающем окне (FeedbackModal): нажал
  // «Создать обращение» под списком, Back закрывает через useModalBack.
  const [createOpen, setCreateOpen] = useState(false);
  useModalBack(() => setCreateOpen(false), createOpen);

  const myFeedbacks = useMyFeedbacksQuery();

  // Бан mid-session: requireUser отвечает 403 — терминальный экран плюс
  // рабочая форма обжалования (публичный appeal с initData, без токена).
  // AccountStatePage — тот же канон, что на экране бана (AuthGate) и в
  // жалобах (ReportsPage): раньше здесь был самодельный EmptyState, и
  // терминальные экраны выглядели в приложении по-разному.
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
                  <Accordion.Summary Component="button" className={AS_BUTTON}>
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
                <Stack>
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
                </Stack>
              )}
            </QueryState>
            {/* Написать новое обращение — из окна: сама страница отвечает за
                FAQ и историю, а форма на весь экран занимала бы его
                целиком. */}
            <Button
              stretched
              size="m"
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
      <FeedbackModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}
