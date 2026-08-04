"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

export async function ensurePushServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return null;
  }

  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function enablePushNotifications() {
  if (!window.isSecureContext) {
    return { ok: false, message: "secure-context-required" };
  }

  if (!("Notification" in window) || !("PushManager" in window)) {
    return { ok: false, message: "push-unsupported" };
  }

  const configResponse = await fetch("/api/push/config", {
    cache: "no-store",
    credentials: "same-origin",
  });

  if (!configResponse.ok) {
    return { ok: false, message: "config-failed" };
  }

  const config = (await configResponse.json().catch(() => null)) as
    | { publicKey?: string | null }
    | null;

  const publicKey = config?.publicKey?.trim();

  if (!publicKey) {
    return { ok: false, message: "config-missing" };
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, message: "permission-denied" };
  }

  const registration = await ensurePushServiceWorker();
  if (!registration) {
    return { ok: false, message: "sw-unsupported" };
  }

  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    await existing.unsubscribe().catch(() => undefined);
  }
  const subscription =
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const payload = subscription.toJSON();
  if (!payload.endpoint || !payload.keys?.p256dh || !payload.keys?.auth) {
    return { ok: false, message: "subscription-invalid" };
  }

  const supabase = createSupabaseBrowserClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    return { ok: false, message: "unauthorized" };
  }

  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.access_token}`,
    },
    credentials: "same-origin",
    body: JSON.stringify({
      endpoint: payload.endpoint,
      expirationTime: payload.expirationTime,
      keys: payload.keys,
      userAgent: navigator.userAgent,
    }),
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, message: data?.error ?? "subscription-failed" };
  }

  return { ok: true, message: "enabled" };
}

export async function registerPushServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  await ensurePushServiceWorker();
  return true;
}
