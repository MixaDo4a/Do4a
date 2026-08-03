import webpush from "web-push";
import type { SupabaseClient } from '@supabase/supabase-js';

const DEFAULT_VAPID_PUBLIC_KEY = "BF1Q5aoYYhlwUtRclWYDernLq4jJgOhJFCg_q05C2kWpiiOk7MbSpbS7ZA_58AK8856JBtmhVXhiL2gpL4hPl28";

export type PushTargetRow = {
  notification_id: string;
  recipient_profile_id: string;
  title: string;
  body: string;
  event_type: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  notification_created_at: string;
  push_subscription_id: string | null;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  user_agent: string | null;
};

let vapidConfigured = false;

function getVapidPublicKey() {
  return process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY?.trim() ?? DEFAULT_VAPID_PUBLIC_KEY;
}

function getVapidPrivateKey() {
  return process.env.PUSH_VAPID_PRIVATE_KEY?.trim() ?? "";
}

function getVapidSubject() {
  return process.env.PUSH_VAPID_SUBJECT?.trim() ?? "mailto:mixarules88@gmail.com";
}

export function isPushEnabled() {
  return Boolean(getVapidPublicKey() && getVapidPrivateKey());
}

function configureWebPush() {
  if (vapidConfigured || !isPushEnabled()) {
    return;
  }

  webpush.setVapidDetails(getVapidSubject(), getVapidPublicKey(), getVapidPrivateKey());
  vapidConfigured = true;
}

function pushUrlForNotification(notification: Pick<PushTargetRow, "related_entity_type" | "related_entity_id">) {
  if (notification.related_entity_type === "shift" && notification.related_entity_id) {
    return `/shifts/${notification.related_entity_id}`;
  }

  if (notification.related_entity_type === "task") {
    return "/tasks";
  }

  if (notification.related_entity_type === "checklist_submission") {
    return "/checklists";
  }

  if (notification.related_entity_type === "schedule") {
    return "/admin?tab=schedule";
  }

  if (notification.related_entity_type === "routine") {
    return "/routine";
  }

  return "/notifications";
}

function buildPayload(notification: Pick<PushTargetRow, "title" | "body" | "event_type" | "related_entity_type" | "related_entity_id">) {
  return JSON.stringify({
    title: notification.title,
    body: notification.body,
    tag: notification.event_type,
    url: pushUrlForNotification(notification),
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
  });
}

function toSubscription(row: Pick<PushTargetRow, "endpoint" | "p256dh" | "auth">) {
  if (!row.endpoint || !row.p256dh || !row.auth) {
    return null;
  }

  return {
    endpoint: row.endpoint,
    keys: {
      p256dh: row.p256dh,
      auth: row.auth,
    },
  };
}

function isMissingSubscription(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }

  const statusCode = "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : null;
  return statusCode === 404 || statusCode === 410;
}

export async function dispatchPushNotificationsFromEvent(
  supabase: SupabaseClient,
  filters: {
    eventType?: string | null;
    relatedEntityType?: string | null;
    relatedEntityId?: string | null;
    recipientProfileId?: string | null;
    sinceMinutes?: number;
  } = {},
) {
  if (!isPushEnabled()) {
    return { ok: false, skipped: true, sent: 0, notifications: 0 };
  }

  const { data, error } = await supabase.rpc("list_push_notification_targets", {
    p_event_type: filters.eventType ?? null,
    p_related_entity_type: filters.relatedEntityType ?? null,
    p_related_entity_id: filters.relatedEntityId ?? null,
    p_recipient_profile_id: filters.recipientProfileId ?? null,
    p_since_minutes: filters.sinceMinutes ?? 30,
  });

  if (error) {
    throw new Error(error.message);
  }

  const targets = (data ?? []) as PushTargetRow[];
  const grouped = new Map<string, PushTargetRow[]>();

  for (const target of targets) {
    const bucket = grouped.get(target.notification_id);
    if (bucket) {
      bucket.push(target);
    } else {
      grouped.set(target.notification_id, [target]);
    }
  }

  let sent = 0;

  configureWebPush();

  for (const [notificationId, rows] of grouped.entries()) {
    let success = false;
    let lastError: string | null = null;

    for (const row of rows) {
      const subscription = toSubscription(row);
      if (!subscription) {
        continue;
      }

      try {
        await webpush.sendNotification(subscription, buildPayload(row));
        success = true;
        sent += 1;
      } catch (error) {
        lastError = error instanceof Error ? error.message : "Push send failed";

        if (isMissingSubscription(error)) {
          await supabase.rpc("deactivate_push_subscription", {
            p_profile_id: row.recipient_profile_id,
            p_endpoint: row.endpoint,
          });
        }
      }
    }

    await supabase.rpc("record_push_delivery", {
      p_notification_id: notificationId,
      p_status: success ? "sent" : "pending",
      p_error_message: success ? null : lastError ?? "Нет активных push-подписок.",
    });
  }

  return { ok: true, skipped: false, sent, notifications: grouped.size };
}
