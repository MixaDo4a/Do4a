"use client";

import { BellRing, Check, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { enablePushNotifications, registerPushServiceWorker } from "@/lib/push-client";

type PushNotificationsPanelProps = {
  hasActiveSubscription: boolean;
};

export function PushNotificationsPanel({ hasActiveSubscription }: PushNotificationsPanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<string>("idle");
  const [loading, setLoading] = useState(false);
  const [subscriptionActive, setSubscriptionActive] = useState(hasActiveSubscription);

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const registration = await navigator.serviceWorker.ready.catch(() => null);
        const subscription = await registration?.pushManager.getSubscription().catch(() => null);

        if (!subscription) {
          if (!cancelled) {
            setSubscriptionActive(false);
          }
          return;
        }

        const response = await fetch(`/api/push/status?endpoint=${encodeURIComponent(subscription.endpoint)}`, {
          cache: "no-store",
          credentials: "same-origin",
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json().catch(() => null)) as { hasActiveSubscription?: boolean } | null;
        if (!cancelled && data?.hasActiveSubscription) {
          setSubscriptionActive(true);
        }
      } catch {
        // ignore status fetch failures and keep the server-rendered state
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onEnable() {
    setLoading(true);
    try {
      await registerPushServiceWorker();
      const result = await enablePushNotifications();
      setStatus(result.ok ? "enabled" : result.message);
      if (result.ok) {
        setSubscriptionActive(true);
        router.refresh();
      }
    } catch {
      setStatus("error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-4 ui-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BellRing size={16} className="text-brand" />
            Push-уведомления на телефон
          </p>
          <p className="mt-1 text-xs text-muted">
            Подключите браузерные push-уведомления, чтобы сообщения приходили даже при закрытом приложении.
          </p>
        </div>
        {!subscriptionActive ? (
          <button
            className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-brand px-4 text-sm font-semibold text-white shadow-soft transition hover:brightness-110 disabled:opacity-60"
            disabled={loading}
            onClick={onEnable}
            type="button"
          >
            {loading ? <Smartphone size={16} className="animate-pulse" /> : <Check size={16} />}
            {loading ? "Подключаем..." : "Включить push"}
          </button>
        ) : null}
      </div>
      {status !== "idle" ? (
        <p className="mt-3 text-xs text-muted">
          {status === "enabled"
            ? "Push-уведомления подключены."
            : status === "permission-denied"
              ? "Доступ к уведомлениям не выдан."
              : status === "push-unsupported"
                ? "В этом браузере push-уведомления недоступны. Для PWA используйте Chrome / Edge, а на iPhone — установленный на домашний экран web app."
                : status === "secure-context-required"
                  ? "Push-уведомления доступны только в HTTPS или localhost."
                  : status === "config-missing"
                    ? "Push-уведомления не настроены на этом развертывании."
                    : status === "config-failed"
                      ? "Не удалось получить ключ настройки push."
                      : status === "sw-unsupported"
                        ? "Service Worker недоступен."
                        : status === "unauthorized"
                          ? "Сначала войдите в приложение."
                          : "Не удалось подключить push-уведомления."}
        </p>
      ) : null}
    </section>
  );
}
