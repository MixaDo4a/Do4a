import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentEmployeeId,
  getCurrentRoleCodes,
  hasAnyRole,
  MANAGE_ROLES,
  RoleRelation,
  roleCodeFromRelation,
  TASK_CREATOR_ROLES,
} from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { advanceTaskRecurrenceRun, type TaskRecurrenceFrequency } from "@/lib/task-recurrence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function tasksUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/tasks", request.url);
  url.searchParams.set("message", message);

  if (detail) {
    url.searchParams.set("detail", detail);
  }

  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const storeId = value(formData, "store_id");
  const assigneeEmployeeId = value(formData, "assignee_employee_id");
  const title = value(formData, "title");
  const description = value(formData, "description");
  const dueAt = value(formData, "due_at");
  const priority = value(formData, "priority") || "normal";
  const recurrenceFrequency = value(formData, "recurrence_frequency");

  if (!storeId || !assigneeEmployeeId || !title) {
    return NextResponse.redirect(tasksUrl(request, "task-required"), 303);
  }

  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный приоритет задачи."), 303);
  }

  const recurrenceEnabled = recurrenceFrequency && recurrenceFrequency !== "none";
  const isValidRecurrenceFrequency = ["daily", "weekly", "monthly"].includes(recurrenceFrequency);
  if (recurrenceFrequency && recurrenceFrequency !== "none" && !isValidRecurrenceFrequency) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный интервал повторения задачи."), 303);
  }

  let dueAtIso: string | null = null;
  if (dueAt) {
    const dueAtDate = new Date(dueAt);
    if (Number.isNaN(dueAtDate.getTime())) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректная дата задачи."), 303);
    }
    dueAtIso = dueAtDate.toISOString();
  }

  if (recurrenceEnabled && !dueAtIso) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Для повторяющейся задачи укажите дату и время первого запуска."), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, TASK_CREATOR_ROLES)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Недостаточно прав для создания задачи."), 303);
  }

  const { employeeId } = await getCurrentEmployeeId();
  const accessibleStores = await getAccessibleStores();
  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  if (!accessibleStoreIds.has(storeId)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Можно ставить задачи только по доступным магазинам."), 303);
  }

  const duplicateWindowStart = new Date(Date.now() - 15_000).toISOString();
  const { data: duplicateTask, error: duplicateError } = await supabase
    .from("tasks")
    .select("id")
    .eq("store_id", storeId)
    .eq("assignee_employee_id", assigneeEmployeeId)
    .eq("title", title)
    .eq("priority", priority)
    .eq("status", "open")
    .gte("created_at", duplicateWindowStart)
    .maybeSingle<{ id: string }>();

  if (duplicateError) {
    return NextResponse.redirect(tasksUrl(request, "task-error", duplicateError.message), 303);
  }

  if (duplicateTask) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Похоже, такая задача уже была создана только что."), 303);
  }

  const { data: assigneeStoreAssignment, error: assigneeStoreError } = await supabase
    .from("employee_store_assignments")
    .select("employee_id")
    .eq("employee_id", assigneeEmployeeId)
    .eq("store_id", storeId)
    .lte("valid_from", new Date().toISOString().slice(0, 10))
    .or(`valid_to.is.null,valid_to.gte.${new Date().toISOString().slice(0, 10)}`)
    .maybeSingle<{ employee_id: string }>();

  if (assigneeStoreError || !assigneeStoreAssignment) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Можно ставить задачи только сотрудникам выбранного магазина."), 303);
  }

  const warehouseAssistantOnly = roles.includes("warehouse_assistant") && !hasAnyRole(roles, MANAGE_ROLES);
  if (warehouseAssistantOnly && assigneeEmployeeId !== employeeId) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Помощник кладовщика может ставить задачи только себе."), 303);
  }

  const warehouseManagerOnly = roles.includes("warehouse_manager") && !hasAnyRole(roles, MANAGE_ROLES);
  if (warehouseManagerOnly) {
    const { data: assigneeProfile, error: assigneeError } = await supabase
      .from("profiles")
      .select("id")
      .eq("employee_id", assigneeEmployeeId)
      .maybeSingle<{ id: string }>();

    if (assigneeError || !assigneeProfile) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Сотрудник не найден."), 303);
    }

    const { data: assigneeRoles, error: assigneeRolesError } = await supabase
      .from("user_roles")
      .select("roles(code)")
      .eq("profile_id", assigneeProfile.id)
      .is("revoked_at", null)
      .returns<{ roles: RoleRelation }[]>();

    if (assigneeRolesError || !assigneeRoles.some((row) => roleCodeFromRelation(row.roles) === "warehouse_assistant")) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Кладовщик может ставить задачи только помощнику кладовщика."), 303);
    }
  }

  let recurrenceRuleId: string | null = null;
  if (recurrenceEnabled) {
    const recurrenceDueAt = advanceTaskRecurrenceRun(new Date(dueAtIso as string), recurrenceFrequency as TaskRecurrenceFrequency).toISOString();
    const { data: recurrenceRule, error: recurrenceError } = await supabase
      .from("task_recurrence_rules")
      .insert({
        store_id: storeId,
        assignee_employee_id: assigneeEmployeeId,
        title,
        description: description || null,
        frequency: recurrenceFrequency,
        next_run_at: recurrenceDueAt,
        created_by: user.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (recurrenceError || !recurrenceRule) {
      return NextResponse.redirect(tasksUrl(request, "task-error", recurrenceError?.message ?? "Не удалось создать правило повторения задачи."), 303);
    }

    recurrenceRuleId = recurrenceRule.id;
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      store_id: storeId,
      assignee_employee_id: assigneeEmployeeId,
      created_by: user.id,
      title,
      description: description || null,
      due_at: dueAtIso,
      priority,
      status: "open",
      recurrence_rule_id: recurrenceRuleId,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (recurrenceRuleId) {
      await supabase.from("task_recurrence_rules").delete().eq("id", recurrenceRuleId);
    }
    return NextResponse.redirect(tasksUrl(request, "task-error", error?.message), 303);
  }

  const [{ data: storeRow }, { data: employeeRow }, { data: assigneeRow }] = await Promise.all([
    supabase.from("stores").select("name, city").eq("id", storeId).maybeSingle<{ name: string; city: string }>(),
    employeeId
      ? supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("employees").select("full_name").eq("id", assigneeEmployeeId).maybeSingle<{ full_name: string }>(),
  ]);
  const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : storeId;
  const authorLabel = employeeRow?.full_name ?? "Сотрудник";
  const assigneeLabel = assigneeRow?.full_name ?? "Сотрудник";
  const taskBody = `${assigneeLabel} · ${storeLabel} · ${title}`;

  await supabase.rpc("send_employee_notification", {
    p_employee_id: assigneeEmployeeId,
    p_event_type: "new_task",
    p_title: "Новая задача",
    p_body: taskBody,
    p_related_entity_type: "task",
    p_related_entity_id: data.id,
  });

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: storeId,
    p_event_type: "new_task",
    p_title: "Новая задача",
    p_body: `${authorLabel} поставил задачу на магазин ${storeLabel}: ${title}`,
    p_exclude_profile_id: user.id,
    p_related_entity_type: "task",
    p_related_entity_id: data.id,
  });

  await supabase.rpc("send_store_employees_notification", {
    p_store_id: storeId,
    p_event_type: "new_task",
    p_title: "Новая задача",
    p_body: taskBody,
    p_exclude_employee_id: assigneeEmployeeId,
    p_exclude_profile_id: user.id,
    p_related_entity_type: "task",
    p_related_entity_id: data.id,
  });

  await dispatchPushNotificationsFromEvent(supabase, {
    eventType: "new_task",
    relatedEntityType: "task",
    relatedEntityId: data.id,
  }).catch(() => null);

  return NextResponse.redirect(tasksUrl(request, "task-created"), 303);
}


