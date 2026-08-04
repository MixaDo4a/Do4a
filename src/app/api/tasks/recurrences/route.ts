import { NextResponse } from "next/server";
import { getAccessibleStores } from "@/lib/auth/stores";
import { advanceTaskRecurrenceRun, type TaskRecurrenceFrequency } from "@/lib/task-recurrence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

type RecurrenceRuleRow = {
  id: string;
  store_id: string;
  assignee_employee_id: string;
  title: string;
  description: string | null;
  frequency: TaskRecurrenceFrequency;
  next_run_at: string;
};

function recurrenceBody(taskTitle: string, storeLabel: string, dueAt: string) {
  return `РџРѕРІС‚РѕСЂСЏСЋС‰Р°СЏСЃСЏ Р·Р°РґР°С‡Р° В· ${storeLabel} В· ${taskTitle} В· ${new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dueAt))}`;
}

export async function POST() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const stores = await getAccessibleStores();
  const storeIds = stores.map((store) => store.id);
  if (storeIds.length === 0) {
    return NextResponse.json({ created: 0, advanced: 0 });
  }

  const { data: rules, error } = await supabase
    .from("task_recurrence_rules")
    .select("id, store_id, assignee_employee_id, title, description, frequency, next_run_at")
    .eq("is_active", true)
    .in("store_id", storeIds)
    .lte("next_run_at", new Date().toISOString())
    .order("next_run_at", { ascending: true })
    .returns<RecurrenceRuleRow[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  let created = 0;
  let advanced = 0;

  for (const rule of rules ?? []) {
    let nextRunAt = new Date(rule.next_run_at);

    while (nextRunAt <= new Date()) {
      const dueAt = nextRunAt.toISOString();
      const { data: existingTask, error: existingError } = await supabase
        .from("tasks")
        .select("id")
        .eq("recurrence_rule_id", rule.id)
        .eq("due_at", dueAt)
        .maybeSingle<{ id: string }>();

      if (existingError) {
        return NextResponse.json({ error: existingError.message }, { status: 400 });
      }

      if (!existingTask) {
        const { data: task, error: taskError } = await supabase
          .from("tasks")
          .insert({
            store_id: rule.store_id,
            assignee_employee_id: rule.assignee_employee_id,
            created_by: user.id,
            title: rule.title,
            description: rule.description,
            due_at: dueAt,
            priority: "normal",
            status: "open",
            recurrence_rule_id: rule.id,
          })
          .select("id")
          .single();

        if (taskError) {
          return NextResponse.json({ error: taskError.message }, { status: 400 });
        }

        created += task ? 1 : 0;

        const [{ data: storeRow }, { data: assigneeRow }] = await Promise.all([
          supabase.from("stores").select("name, city").eq("id", rule.store_id).maybeSingle<{ name: string; city: string }>(),
          supabase.from("employees").select("full_name").eq("id", rule.assignee_employee_id).maybeSingle<{ full_name: string }>(),
        ]);

        const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : "РњР°РіР°Р·РёРЅ";
        const assigneeLabel = assigneeRow?.full_name ?? "РЎРѕС‚СЂСѓРґРЅРёРє";
        const taskMessage = recurrenceBody(rule.title, storeLabel, dueAt);

        await supabase.rpc("send_employee_notification", {
          p_employee_id: rule.assignee_employee_id,
          p_event_type: "recurring_task_created",
          p_title: "РџРѕРІС‚РѕСЂСЏСЋС‰Р°СЏСЃСЏ Р·Р°РґР°С‡Р°",
          p_body: taskMessage,
          p_related_entity_type: "task",
          p_related_entity_id: task.id,
        });

        await supabase.rpc("send_store_managers_notification", {
          p_store_id: rule.store_id,
          p_event_type: "recurring_task_created",
          p_title: "РџРѕРІС‚РѕСЂСЏСЋС‰Р°СЏСЃСЏ Р·Р°РґР°С‡Р°",
          p_body: `${assigneeLabel} В· ${storeLabel} В· ${rule.title}`,
          p_related_entity_type: "task",
          p_related_entity_id: task.id,
        });

        await supabase.rpc("send_store_employees_notification", {
          p_store_id: rule.store_id,
          p_event_type: "recurring_task_created",
          p_title: "РџРѕРІС‚РѕСЂСЏСЋС‰Р°СЏСЃСЏ Р·Р°РґР°С‡Р°",
          p_body: `${assigneeLabel} В· ${storeLabel} В· ${rule.title}`,
          p_exclude_employee_id: rule.assignee_employee_id,
          p_related_entity_type: "task",
          p_related_entity_id: task.id,
        });
      }

      nextRunAt = advanceTaskRecurrenceRun(nextRunAt, rule.frequency);
      advanced += 1;
    }

    if (nextRunAt.toISOString() !== rule.next_run_at) {
      const { error: updateError } = await supabase
        .from("task_recurrence_rules")
        .update({
          next_run_at: nextRunAt.toISOString(),
        })
        .eq("id", rule.id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 400 });
      }
    }
  }

  await dispatchPushNotificationsFromEvent(supabase, { eventType: "recurring_task_created", sinceMinutes: 15 }).catch(() => null);

  return NextResponse.json({ ok: true, created, advanced });
}

