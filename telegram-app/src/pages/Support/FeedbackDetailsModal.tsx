import { useState } from "react";
import { Caption, Subheadline } from "@telegram-apps/telegram-ui";
import type { UserFeedbackDto } from "@edem/contracts";

import { OfflineBanner } from "@/components/OfflineBanner";
import { StatusPill } from "@/components/StatusPill/StatusPill";
import { Sheet } from "@/ui/Sheet";
import { Stack } from "@/ui/Stack";
import { Blockquote } from "@/ui/Blockquote";
import { moscowNumericDate } from "@/utils/date";

import { feedbackStatus } from "./feedbackPreview";
import styles from "./SupportPage.module.css";

/**
 * Попап с подробностями обращения — по тапу на строку списка.
 *
 * Хост-managed (`feedback` + `onClose`): Back перехватывает `useModalBack`
 * страницы. `feedback === null` = «окно закрыто».
 *
 * Контейнер — `ui/Sheet`, как у всех модалок приложения (включая соседнюю
 * `FeedbackModal` на этом же экране). Тело построено тем же каноном, что и
 * детали жалобы (`ReportDetailsModal`): шапка (предмет + статус-пилюля),
 * дата справкой, свободные тексты — плашками `ui/Blockquote`.
 *
 * `retained` (ниже) нужен из-за exit-анимации Sheet: при закрытии `feedback`
 * становится null, а шторка ещё играет анимацию — тело, зануленное вместе с
 * пропом, мигнуло бы пустотой. Radix `Presence` держит узел до конца
 * анимации, поэтому удержание даёт окну закрыться поверх прежнего
 * содержимого. СОСТОЯНИЕ, а не ref: чтение ref во время рендера запрещено
 * правилом react-hooks/refs.
 */
export function FeedbackDetailsModal({
  feedback,
  onClose,
}: {
  feedback: UserFeedbackDto | null;
  onClose: () => void;
}) {
  const [retained, setRetained] = useState(feedback);
  if (feedback !== null && feedback !== retained) setRetained(feedback);
  const visible = feedback ?? retained;
  return (
    <Sheet open={feedback !== null} onClose={onClose} title="Обращение">
      <OfflineBanner />
      {visible === null ? null : <FeedbackDetailsBody feedback={visible} />}
    </Sheet>
  );
}

/**
 * Тело попапа без обёртки Sheet — экспортируется ради SSR-тестов: Modal кита
 * это портал, в renderToString он не попадает.
 *
 * Раскладка — сверху вниз по смыслу: ЧТО за обращение и его состояние пилюлей
 * → когда отправлено → САМ ТЕКСТ обращения в плашке → ответ поддержки, если он
 * есть. Пока ответа нет — вместо блока ответа идёт справка, что мы напишем
 * здесь же.
 */
export function FeedbackDetailsBody({
  feedback,
}: {
  feedback: UserFeedbackDto;
}) {
  const status = feedbackStatus(feedback);
  const replied = feedback.repliedAt
    ? moscowNumericDate(feedback.repliedAt)
    : "";
  return (
    <Stack>
      {/* Предмет обращения и его состояние одной строкой: статус — главный
          признак, ради которого открывают попап, и он читается одинаково со
          списком обращений и жалобами (StatusPill). */}
      <div className={styles.detailsHead}>
        <Subheadline weight="2" className={styles.detailsSubject}>
          {feedback.subject}
        </Subheadline>
        <StatusPill tone={status.tone}>{status.label}</StatusPill>
      </div>
      <Caption className={styles.detailsDate}>
        {`Отправлено ${moscowNumericDate(feedback.createdAt)}`}
      </Caption>
      {/* Текст обращения — слова автора, поэтому плашка-цитата: она и отделяет
          его от служебных строк, и хранит переносы, набранные человеком. */}
      <Blockquote>{feedback.text}</Blockquote>
      {feedback.reply !== null ? (
        <>
          <Caption className={styles.detailsLabel}>
            {replied ? `Ответ поддержки · ${replied}` : "Ответ поддержки"}
          </Caption>
          <Blockquote tone="info">{feedback.reply}</Blockquote>
        </>
      ) : (
        <Caption className={styles.detailsLabel}>
          Поддержка ещё не ответила. Мы свяжемся с вами здесь — список обновится
          автоматически.
        </Caption>
      )}
    </Stack>
  );
}
