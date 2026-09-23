import { memo, useState } from "react";
import {
  Button,
  Caption,
  Input,
  Modal,
  Textarea,
} from "@telegram-apps/telegram-ui";
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
import {
  SheetTitle,
  useSheetTitleId,
} from "@/components/SheetTitle/SheetTitle";
import { SheetBody } from "@/ui/SheetBody";
import { Stack } from "@/ui/Stack";
import styles from "./ProfileModals.module.css";

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
  const titleId = useSheetTitleId();
  // Тело держит name/about в useState с инициализацией от profile.data:
  // при прямом входе на /profile/edit (пустой кэш) данные приезжают ПОСЛЕ
  // маунта и форма осталась бы пустой. key по id пользователя перемонтирует
  // тело по arrival данных (react-query dedupe — второго запроса нет);
  // правки после загрузки не сбрасываются (id стабилен).
  const profile = useProfileQuery();
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Редактировать профиль</Modal.Header>}
      aria-labelledby={titleId}
    >
      <SheetBody>
        <SheetTitle titleId={titleId}>Редактировать профиль</SheetTitle>
        <EditProfileBody key={profile.data?.id ?? "loading"} onDone={onClose} />
      </SheetBody>
    </Modal>
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
  const [formError, setFormError] = useState<string | null>(null);

  useClosingConfirmation(
    name !== (profile.data?.name ?? "") ||
      about !== (profile.data?.about ?? ""),
  );

  const save = () => {
    const error = validateProfileForm(name, about);
    if (error) {
      haptic.error();
      setFormError(error);
      return;
    }
    setFormError(null);
    update.mutate(normalizeProfileForm(name, about), {
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
      <p role="alert">
        {profile.error instanceof Error
          ? profile.error.message
          : "Не удалось загрузить профиль"}
      </p>
    );
  }

  return (
    <Stack>
      <div>
        <label htmlFor="profile-name" className="sr-only">
          Имя
        </label>
        <Input
          id="profile-name"
          header="Имя"
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value);
            if (formError) setFormError(null);
          }}
        />
      </div>
      <div>
        <label htmlFor="profile-about" className="sr-only">
          О себе
        </label>
        <Textarea
          id="profile-about"
          header="О себе"
          rows={3}
          maxLength={500}
          placeholder="Например: за рулём 7 лет, люблю музыку 80-х"
          value={about}
          onChange={(event) => {
            setAbout(event.target.value);
            if (formError) setFormError(null);
          }}
        />
      </div>
      {(formError || update.error) && (
        <Caption
          Component="p"
          role="alert"
          className={styles.errorText}
        >
          {formError ??
            (update.error instanceof Error
              ? update.error.message
              : "Не удалось сохранить")}
        </Caption>
      )}
      <div className={styles.actions}>
        <Button
          mode="bezeled"
          stretched
          size="l"
          loading={update.isPending}
          disabled={update.isPending}
          onClick={save}
        >
          Сохранить изменения
        </Button>
        <Button
          mode="bezeled"
          size="l"
          stretched
          disabled={update.isPending}
          onClick={onDone}
        >
          Отмена
        </Button>
      </div>
    </Stack>
  );
});
