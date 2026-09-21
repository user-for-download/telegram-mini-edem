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
} from "@/pages/profileValidation";

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
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      header={<Modal.Header>Редактировать профиль</Modal.Header>}
    >
      <div className="px-4 pt-2 pb-10 max-h-[82dvh] overflow-y-auto">
        <EditProfileBody onDone={onClose} />
      </div>
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
    <div className="flex flex-col gap-3">
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
          className="text-(--tg-theme-destructive-text-color)"
        >
          {formError ??
            (update.error instanceof Error
              ? update.error.message
              : "Не удалось сохранить")}
        </Caption>
      )}
      <div className="flex flex-col gap-2">
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
    </div>
  );
});
