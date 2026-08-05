"use client";

import { BellRing, Check, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { enablePushNotifications, registerPushServiceWorker } from "@/lib/push-client";

type PushNotificationsPanelProps = {
  hasActiveSubscription: boolean;
};

const statusMessages: Record<string, string> = {
  enabled: "Push-уведомления подключены.",
  "permission-denied": "Доступ к уведомлениям не выдан.",
  "push-unsupported":
    "В этом браузере push-уведомления недоступны. Для PWA используйте Chrome / Edge, а на iPhone — установленное на экран \"Домой\" web-приложение.",
  "secure-context-required": "Push-уведомления доступны только по HTTPS или на localhost.",
  "config-missing": "Push-уведомления не настроены на этом развертывании.",
  "config-failed": "Не удалось получить ключ настройки push.",
  "sw-unsupported": "Service Worker недоступен.",
  unauthorized: "Сначала войдите в приложение.",
  "subscription-failed": "Не удалось подключить push-уведомления.",
  "subscription-invalid": "Не удалось подключить push-уведомления.",
  error: "Не удалось подключить push-уведомления.",
  idle: "",
};

export function PushNotificationsPanel({ hasActiveSubscription }: PushNotificationsPanelProps) {
  const router = useRouter();
  const [status, setStatus] = useState<string>("idle");
  const [loading, setLoading] = useState(false);
  const [subscriptionActive, setSubscriptionActive] = useState<boolean | null>(
    hasActiveSubscription ? true : null,
  );

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
        if (!cancelled) {
          setSubscriptionActive(Boolean(data?.hasActiveSubscription));
        }
      } catch {
        if (!cancelled) {
          setSubscriptionActive(false);
        }
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

  const message = statusMessages[status] ?? statusMessages.error;

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
        {subscriptionActive === false ? (
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
      {status !== "idle" ? <p className="mt-3 text-xs text-muted">{message}</p> : null}
    </section>
  );
}
