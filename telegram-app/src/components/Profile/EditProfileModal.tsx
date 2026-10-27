import { memo, useRef, useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";
import { QueryState } from "@/components/QueryState";
import { EMPTY_STATES } from "@/ui/emptyStates";
import { OfflineBanner } from "@/components/OfflineBanner";

import { useNavigate } from "react-router-dom";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import { useToast } from "@/components/Toast/ToastProvider";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useSessionDraft } from "@/hooks/useSessionDraft";
import { useAuthStore } from "@/store/useAuthStore";
import { useProfileQuery, useProfileUpdateMutation } from "@/queries/profile";
import {
  normalizeProfileForm,
  validateProfileFields,
  type ProfileFieldError,
} from "@/pages/Profile/profileValidation";
import { Stack } from "@/ui/Stack";

interface ProfileDraft {
  name: string;
  about: string;
  phone: string;
}

/**
 * Редактирование профиля — модальная шторка поверх «Профиля»
 * (стандарт route-backed модалок): имя + «О себе», валидация,
 * closing-confirmation при грязной форме. Путь /profile/edit.
 */
export function EditProfileModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  // Имя диалога для скринридера + видимый заголовок на base-платформе
  // (tgui Modal.Header рисует текст только на iOS).
  // Тело инициализирует черновик данными profile.data:
  // при прямом входе на /profile/edit (пустой кэш) данные приезжают ПОСЛЕ
  // маунта и форма осталась бы пустой. key по id пользователя перемонтирует
  // тело по arrival данных (react-query dedupe — второго запроса нет);
  // правки после загрузки не сбрасываются (id стабилен).
  const profile = useProfileQuery();
  return (
    <Sheet open={open} onClose={onClose} title="Редактировать профиль">
      <OfflineBanner />
      <EditProfileBody key={profile.data?.id ?? "loading"} onDone={onClose} />
    </Sheet>
  );
}

// Фон ОТКРЫТЫЙ, как в SettingsRoute и VehicleRoute: затемнение приезжает
// из китового Modal и перехватывает указатель, так что профиль под
// шторкой не кликается и не скроллится. Раньше здесь был
// `<div aria-hidden hidden>` — он выкидывал фон из дерева доступности и
// оставлял под шторкой пустоту.
export function EditProfileRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  };
  return (
    <>
      <ProfilePage />
      <EditProfileModal open onClose={close} />
    </>
  );
}

export const EditProfileBody = memo(function EditProfileBody({
  onDone,
}: {
  onDone: () => void;
}) {
  const toast = useToast();
  const profile = useProfileQuery();
  const update = useProfileUpdateMutation();
  const ownerId = useAuthStore((state) => state.user?.id ?? null);
  const profileData = profile.data?.id === ownerId ? profile.data : undefined;
  const [form, setForm, clearDraft, captureSubmission] = useSessionDraft<ProfileDraft>(
    `profile:edit:${profileData?.id ?? "loading"}`,
    () => ({
      name: profileData?.name ?? "",
      about: profileData?.about ?? "",
      phone: profileData?.phone ?? "",
    }),
  );
  const { name, about, phone } = form;
  // Хранится id поля, а не текст: ошибку привязывает <Field>, который ставит
  // aria-invalid + aria-describedby.
  const [fieldError, setFieldError] = useState<ProfileFieldError | null>(null);
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const errorFor = (id: string) =>
    invalidField === id ? fieldError?.message : undefined;
  // Ошибка поля рисуется самим <Field>; общий Notice остаётся только для
  // ошибок сервера — иначе один и тот же текст дублировался бы дважды.
  const formError = update.error;
  const clearErrors = () => {
    setFieldError(null);
    setInvalidField(null);
  };

  useClosingConfirmation(
    name !== (profileData?.name ?? "") ||
      about !== (profileData?.about ?? "") ||
      phone !== (profileData?.phone ?? ""),
  );

  // Защита от двойного сабмита: ref синхронен (в отличие от state), второй
  // клик до ре-рендера не отправит второй запрос. Тот же приём, что в
  // VehicleModal / ReviewsPage / ComplaintForm — раньше эта форма была
  // единственной без него, и `disabled={update.isPending}` не спасал:
  // он действует только ПОСЛЕ коммита.
  const isSubmittingRef = useRef(false);
  const save = () => {
    if (isSubmittingRef.current) return;
    const error = validateProfileFields(name, about, phone);
    if (error) {
      haptic.error();
      setFieldError(error);
      setInvalidField(error.field);
      return;
    }
    setFieldError(null);
    setInvalidField(null);
    isSubmittingRef.current = true;
    const onCommitted = captureSubmission();
    update.mutate({ ...normalizeProfileForm(name, about, phone), onCommitted }, {
      onSuccess: () => {
        if (!onCommitted()) return;
        haptic.success();
        toast.show({ text: "Профиль обновлён" });
        onDone();
      },
      onError: () => haptic.error(),
      onSettled: () => {
        isSubmittingRef.current = false;
      },
    });
  };

  if (profile.isLoading || (!profileData && !profile.error)) {
    return (
      <p role="status" aria-label="Загрузка профиля">
        Загрузка…
      </p>
    );
  }

  // Ошибка загрузки — это НЕ ошибка валидации (MEMORY.md §18): раньше
  // здесь стоял тупиковый Notice без единого действия, и выйти из него
  // можно было только закрытием и повторным открытием шторки. Теперь
  // ветка уходит в общий QueryState — ровно как в соседних VehicleModal,
  // SettingsModal и ProfilePage: он один владеет экраном ошибки и
  // кнопкой «Повторить», а повтор зовёт refetch ТОГО ЖЕ запроса, то
  // есть перечитывает профиль, не пересоздавая шторку.
  // loading здесь всегда false: своё состояние загрузки с подписью
  // «Загрузка профиля» отрисовано выше, у QueryState — другое.
  return (
    <QueryState
      loading={false}
      error={profile.error}
      empty={!profileData}
      emptyText={EMPTY_STATES.profileEmpty.description}
      onRetry={() => void profile.refetch()}
    >
      <Stack>
        <Field label="Имя" id="profile-name" error={errorFor("profile-name")}>
          {(field) => (
            <Input
              {...field}
              value={name}
              maxLength={100}
              onChange={(event) => {
                const name = event.target.value;
                setForm((current) => ({ ...current, name }));
                clearErrors();
              }}
            />
          )}
        </Field>
        <Field
          label="О себе"
          id="profile-about"
          error={errorFor("profile-about")}
        >
          {(field) => (
            <Textarea
              {...field}
              rows={3}
              maxLength={500}
              placeholder="Например: за рулём 7 лет, люблю музыку 80-х"
              value={about}
              onChange={(event) => {
                const about = event.target.value;
                setForm((current) => ({ ...current, about }));
                clearErrors();
              }}
            />
          )}
        </Field>
        <Field
          label="Телефон"
          id="profile-phone"
          error={errorFor("profile-phone")}
        >
          {(field) => (
            <Input
              {...field}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={25}
              placeholder="+7 900 123-45-67"
              value={phone}
              onChange={(event) => {
                const phone = event.target.value;
                setForm((current) => ({ ...current, phone }));
                clearErrors();
              }}
            />
          )}
        </Field>
        {formError && (
          <Notice tone="danger" variant="text">
            {formError instanceof Error
              ? formError.message
              : "Не удалось сохранить"}
          </Notice>
        )}
        <Stack gap="xs">
          <Button
            stretched
            size="l"
            variant="primary"
            loading={update.isPending}
            disabled={update.isPending}
            onClick={save}
          >
            Сохранить изменения
          </Button>
          <Button
            size="l"
            stretched
            disabled={update.isPending}
            onClick={() => {
              clearDraft();
              onDone();
            }}
          >
            Отмена
          </Button>
        </Stack>
      </Stack>
    </QueryState>
  );
});
