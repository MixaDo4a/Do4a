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

  return (
    <section className="mt-4 ui-panel p-4 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <BellRing size={16} className="text-brand" />
            Push-СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅР° С‚РµР»РµС„РѕРЅ
          </p>
          <p className="mt-1 text-xs text-muted">
            РџРѕРґРєР»СЋС‡РёС‚Рµ Р±СЂР°СѓР·РµСЂРЅС‹Рµ push-СѓРІРµРґРѕРјР»РµРЅРёСЏ, С‡С‚РѕР±С‹ СЃРѕРѕР±С‰РµРЅРёСЏ РїСЂРёС…РѕРґРёР»Рё РґР°Р¶Рµ РїСЂРё Р·Р°РєСЂС‹С‚РѕРј РїСЂРёР»РѕР¶РµРЅРёРё.
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
            {loading ? "РџРѕРґРєР»СЋС‡Р°РµРј..." : "Р’РєР»СЋС‡РёС‚СЊ push"}
          </button>
        ) : null}
      </div>
      {status !== "idle" ? (
        <p className="mt-3 text-xs text-muted">
          {status === "enabled"
            ? "Push-СѓРІРµРґРѕРјР»РµРЅРёСЏ РїРѕРґРєР»СЋС‡РµРЅС‹."
            : status === "permission-denied"
              ? "Р”РѕСЃС‚СѓРї Рє СѓРІРµРґРѕРјР»РµРЅРёСЏРј РЅРµ РІС‹РґР°РЅ."
              : status === "push-unsupported"
                ? "Р’ СЌС‚РѕРј Р±СЂР°СѓР·РµСЂРµ push-СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅРµРґРѕСЃС‚СѓРїРЅС‹. Р”Р»СЏ PWA РёСЃРїРѕР»СЊР·СѓР№С‚Рµ Chrome / Edge, Р° РЅР° iPhone вЂ” СѓСЃС‚Р°РЅРѕРІР»РµРЅРЅС‹Р№ РЅР° РґРѕРјР°С€РЅРёР№ СЌРєСЂР°РЅ web app."
                : status === "secure-context-required"
                  ? "Push-СѓРІРµРґРѕРјР»РµРЅРёСЏ РґРѕСЃС‚СѓРїРЅС‹ С‚РѕР»СЊРєРѕ РІ HTTPS РёР»Рё localhost."
                  : status === "config-missing"
                    ? "Push-СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅРµ РЅР°СЃС‚СЂРѕРµРЅС‹ РЅР° СЌС‚РѕРј СЂР°Р·РІРµСЂС‚С‹РІР°РЅРёРё."
                    : status === "config-failed"
                      ? "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕР»СѓС‡РёС‚СЊ РєР»СЋС‡ РЅР°СЃС‚СЂРѕР№РєРё push."
                      : status === "sw-unsupported"
                        ? "Service Worker РЅРµРґРѕСЃС‚СѓРїРµРЅ."
                        : status === "unauthorized"
                          ? "РЎРЅР°С‡Р°Р»Р° РІРѕР№РґРёС‚Рµ РІ РїСЂРёР»РѕР¶РµРЅРёРµ."
                          : "РќРµ СѓРґР°Р»РѕСЃСЊ РїРѕРґРєР»СЋС‡РёС‚СЊ push-СѓРІРµРґРѕРјР»РµРЅРёСЏ."}
        </p>
      ) : null}
    </section>
  );
}
