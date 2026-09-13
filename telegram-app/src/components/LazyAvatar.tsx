import { useEffect, useRef, useState } from "react";
import { Avatar } from "@telegram-apps/telegram-ui";

export interface LazyAvatarProps {
  src?: string | null;
  acronym?: string;
  size?: 20 | 24 | 28 | 40 | 48 | 96;
  alt?: string;
  className?: string;
}

/** Собственная проверка окружения: в SSR (renderToString) эффектов нет,
 *  поэтому начальное состояние сразу показывает контент/плейсхолдер. */
function isObserverAvailable(): boolean {
  return typeof IntersectionObserver !== "undefined";
}

/**
 * Ленивый аватар для списков (собственная реализация, не код TelegramOrg):
 * до входа во вьюпорт — плейсхолдер с acronym, src подставляется при
 * intersecting через IntersectionObserver с cleanup.
 *
 * SSR-safe: эффекты в renderToString не выполняются, начальное состояние
 * при отсутствии observer — сразу видимый (fallback показывает контент).
 *
 * a11y: осмысленный alt (имя человека), плейсхолдер загрузки —
 * role="status" + aria-label, ошибка загрузки — fallback на acronym.
 */
export function LazyAvatar({
  src,
  acronym = "?",
  size = 40,
  alt,
  className,
}: LazyAvatarProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState<boolean>(() => !isObserverAvailable());
  const [failed, setFailed] = useState(false);

  const label =
    alt ?? (acronym !== "?" && acronym !== "" ? `Аватар ${acronym}` : "Аватар пользователя");
  const cleanSrc = typeof src === "string" && src.length > 0 ? src : undefined;
  const showImage = inView && cleanSrc !== undefined && !failed;

  useEffect(() => {
    if (inView) return;
    if (!isObserverAvailable()) {
      setInView(true);
      return;
    }
    const node = boxRef.current;
    if (!node) {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            break;
          }
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  useEffect(() => {
    setFailed(false);
  }, [cleanSrc]);

  if (!showImage) {
    const loading = cleanSrc !== undefined && !failed;
    if (loading) {
      return (
        <div ref={boxRef} className={className}>
          <span role="status" aria-label="Загрузка аватара">
            <Avatar
              size={size}
              acronym={acronym}
              alt={label}
              className="animate-pulse motion-reduce:animate-none"
            />
          </span>
        </div>
      );
    }
    return (
      <div ref={boxRef} className={className}>
        <Avatar size={size} acronym={acronym} alt={label} />
      </div>
    );
  }

  return (
    <div ref={boxRef} className={className}>
      <Avatar
        size={size}
        src={cleanSrc}
        acronym={acronym}
        alt={label}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
