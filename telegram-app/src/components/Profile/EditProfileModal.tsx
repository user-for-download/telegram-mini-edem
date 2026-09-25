import { memo, useState } from "react";
import { Input, Textarea } from "@telegram-apps/telegram-ui";
import { Notice } from "@/ui/Notice";
import { Field } from "@/ui/Field";
import { Sheet } from "@/ui/Sheet";
import { Button } from "@/ui/Button";

import { useNavigate } from "react-router-dom";
import { ProfilePage } from "@/pages/Profile/ProfilePage";
import { useToast } from "@/components/Toast/ToastProvider";
import { haptic } from "@/utils/haptics";
import { useClosingConfirmation } from "@/hooks/useClosingConfirmation";
import { useProfileQuery, useProfileUpdateMutation } from "@/queries/profile";
import {
  normalizeProfileForm,
  validateProfileForm,
} from "@/pages/Profile/profileValidation";
import { Stack } from "@/ui/Stack";

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
  // Тело держит name/about в useState с инициализацией от profile.data:
  // при прямом входе на /profile/edit (пустой кэш) данные приезжают ПОСЛЕ
  // маунта и форма осталась бы пустой. key по id пользователя перемонтирует
  // тело по arrival данных (react-query dedupe — второго запроса нет);
  // правки после загрузки не сбрасываются (id стабилен).
  const profile = useProfileQuery();
  return (
    <Sheet open={open} onClose={onClose} title="Редактировать профиль">
      <EditProfileBody key={profile.data?.id ?? "loading"} onDone={onClose} />
    </Sheet>
  );
}

export function EditProfileRoute() {
  const navigate = useNavigate();
  const close = () => {
    const historyIndex = window.history.state?.idx;
    if (typeof historyIndex === "number" && historyIndex > 0) navigate(-1);
    else navigate("/profile", { replace: true });
  };
  return (
    <>
      <div aria-hidden hidden>
        <ProfilePage />
      </div>
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
  const [name, setName] = useState(profile.data?.name ?? "");
  const [about, setAbout] = useState(profile.data?.about ?? "");
  const [phone, setPhone] = useState(profile.data?.phone ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  useClosingConfirmation(
    name !== (profile.data?.name ?? "") ||
      about !== (profile.data?.about ?? "") ||
      phone !== (profile.data?.phone ?? ""),
  );

  const save = () => {
    const error = validateProfileForm(name, about, phone);
    if (error) {
      haptic.error();
      setFormError(error);
      return;
    }
    setFormError(null);
    update.mutate(normalizeProfileForm(name, about, phone), {
      onSuccess: () => {
        haptic.success();
        toast.show({ text: "Профиль обновлён" });
        onDone();
      },
      onError: () => haptic.error(),
    });
  };

  if (profile.isLoading) {
    return (
      <p role="status" aria-label="Загрузка профиля">
        Загрузка…
      </p>
    );
  }
  if (!profile.data) {
    return (
      <Notice role="alert" tone="danger" variant="text">
        {profile.error instanceof Error
          ? profile.error.message
          : "Не удалось загрузить профиль"}
      </Notice>
    );
  }

  return (
    <Stack>
      <Field label="Имя" id="profile-name">
        {(field) => (
          <Input
            {...field}
            value={name}
            maxLength={100}
            onChange={(event) => {
              setName(event.target.value);
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      <Field label="О себе" id="profile-about">
        {(field) => (
          <Textarea
            {...field}
            rows={3}
            maxLength={500}
            placeholder="Например: за рулём 7 лет, люблю музыку 80-х"
            value={about}
            onChange={(event) => {
              setAbout(event.target.value);
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      <Field label="Телефон" id="profile-phone">
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
              setPhone(event.target.value);
              if (formError) setFormError(null);
            }}
          />
        )}
      </Field>
      {(formError || update.error) && (
        <Notice tone="danger" variant="text">
          {formError ??
            (update.error instanceof Error
              ? update.error.message
              : "Не удалось сохранить")}
        </Notice>
      )}
      <Stack gap="xs">
        <Button
          stretched
          size="l"
          loading={update.isPending}
          disabled={update.isPending}
          onClick={save}
        >
          Сохранить изменения
        </Button>
        <Button size="l" stretched disabled={update.isPending} onClick={onDone}>
          Отмена
        </Button>
      </Stack>
    </Stack>
  );
});
