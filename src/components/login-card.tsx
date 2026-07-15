"use client";

import Image from "next/image";
import { BellRing, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type LoginCardProps = {
  initialMessage: string | null;
};

const toastByMessage: Record<string, string> = {
  "email-required": "Введите email.",
  "password-required": "Введите пароль.",
  "login-error": "Неверный Email или пароль.",
  "password-login-error": "Неверный Email или пароль.",
  "check-email": "Проверьте почту: мы отправили ссылку для входа.",
  "session-expired": "Сессия истекла.",
  "logged-out": "Вы вышли из учетной записи.",
};

const fieldClass =
  "login-field group flex h-[70px] items-center gap-4 rounded-[22px] border border-[#353030] bg-[#0d0d0d] px-5 transition duration-200 focus-within:border-[#7c2328] focus-within:shadow-none";

export function LoginCard({ initialMessage }: LoginCardProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [toastVisible, setToastVisible] = useState(Boolean(initialMessage));
  const toastText = useMemo(
    () => (initialMessage ? toastByMessage[initialMessage] ?? initialMessage : null),
    [initialMessage]
  );

  useEffect(() => {
    if (!toastText) {
      return;
    }

    setToastVisible(true);
    const timer = window.setTimeout(() => {
      setToastVisible(false);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [toastText]);

  return (
    <>
      {toastText && toastVisible ? (
        <div className="toast-message fixed left-1/2 top-4 z-50 flex w-[min(92vw,42rem)] -translate-x-1/2 items-center gap-3 rounded-2xl border border-[#cc1f2f]/70 bg-[#120b0c]/92 px-4 py-3 text-sm text-white shadow-[0_18px_40px_rgba(0,0,0,0.45)] backdrop-blur-xl">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#c1121f] text-white">
            <BellRing size={18} />
          </span>
          <span>{toastText}</span>
        </div>
      ) : null}

      <section className="login-shell relative w-[min(92vw,430px)] overflow-hidden rounded-[40px] border border-[#d83a44]/58 bg-[#050405]/97 shadow-[0_0_0_1px_rgba(255,84,96,0.16),0_0_34px_rgba(193,18,31,0.45),0_22px_60px_rgba(0,0,0,0.74)] backdrop-blur-2xl">
        <div className="relative h-[500px] overflow-hidden sm:h-[580px]">
          <Image
            alt="Do4a background"
            className="login-hero object-cover object-center"
            fill
            priority
            sizes="430px"
            src="/login-bg.png"
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05),rgba(0,0,0,0.38)_60%,rgba(6,5,6,0.98)_100%)]" />
          <div className="absolute inset-x-0 bottom-0 h-[170px] bg-[linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0.2)_25%,rgba(6,5,6,1)_100%)]" />
          <div className="absolute inset-x-0 top-0 h-[140px] bg-[linear-gradient(180deg,rgba(0,0,0,0.16),rgba(0,0,0,0))]" />

          <div className="absolute inset-x-0 bottom-[56px] flex flex-col items-center">
            <div className="mt-4 text-center text-[35px] font-semibold leading-none text-[#d6b36a] drop-shadow-[0_0_16px_rgba(214,179,106,0.28)]">
              Do4a Staff Only
            </div>
          </div>
        </div>

        <form action="/login/password" method="post" className="grid gap-7 px-5 pb-8 pt-3 sm:px-6 sm:pb-9">
          <label className={fieldClass}>
            <Mail className="shrink-0 text-[#df2431]" size={25} />
            <input
              className="h-full w-full bg-[#0d0d0d] text-[18px] text-[#f2ece7] outline-none placeholder:text-[#8c8582]"
              name="email"
              placeholder="Email"
              type="email"
              autoComplete="email"
            />
          </label>

          <label className={fieldClass}>
            <Lock className="shrink-0 text-[#df2431]" size={25} />
            <input
              className="h-full w-full bg-[#0d0d0d] text-[18px] text-[#f2ece7] outline-none placeholder:text-[#8c8582]"
              name="password"
              placeholder="Пароль"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
            />
            <button
              aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
              className="grid h-10 w-10 shrink-0 place-items-center text-[#878180] transition hover:text-[#f2ece7]"
              type="button"
              onClick={() => setShowPassword((value) => !value)}
            >
              {showPassword ? <EyeOff size={26} /> : <Eye size={26} />}
            </button>
          </label>

          <button
            className="login-submit relative mt-1 flex h-[70px] items-center justify-center overflow-hidden rounded-[22px] border border-[#353030] bg-transparent transition duration-200 active:scale-[0.98]"
            type="submit"
          >
            <Image
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full object-cover object-center"
              fill
              sizes="(max-width: 640px) 100vw, 430px"
              src="/login-button-bg.png"
            />
            <span className="absolute inset-0 z-10 grid place-items-center text-[30px] font-semibold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.55)]">
              Вход
            </span>
          </button>
        </form>
      </section>
    </>
  );
}
