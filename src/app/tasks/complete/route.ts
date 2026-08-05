import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

function tasksUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/tasks", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const taskId = String(formData.get("task_id") ?? "").trim();

  if (!taskId) {
    return NextResponse.redirect(tasksUrl(request, "task-required"), 303);
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url), 303);
  }

  const { employeeId } = await getCurrentEmployeeId();
  const { roles } = await getCurrentRoleCodes();
  const canManageTasks = hasAnyRole(roles, MANAGE_ROLES);
  const { data: task, error: readError } = await supabase
    .from("tasks")
    .select("id, assignee_employee_id, store_id, title, created_by")
    .eq("id", taskId)
    .maybeSingle<{ id: string; assignee_employee_id: string; store_id: string; title: string; created_by: string | null }>();

  if (readError || !task) {
    return NextResponse.redirect(tasksUrl(request, "task-error", readError?.message ?? "Задача не найдена."), 303);
  }

  if (!canManageTasks && task.assignee_employee_id !== employeeId) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Недостаточно прав для изменения задачи."), 303);
  }

  const { data, error } = await supabase
    .from("tasks")
    .update({ status: "done", completed_at: new Date().toISOString(), completed_by: user.id })
    .eq("id", taskId)
    .select("id, created_by")
    .maybeSingle();

  if (error || !data) {
    return NextResponse.redirect(tasksUrl(request, "task-error", error?.message ?? "Задача не найдена или уже обработана."), 303);
  }

  const [{ data: storeRow }, { data: employeeRow }] = await Promise.all([
    supabase.from("stores").select("name, city").eq("id", task.store_id).maybeSingle<{ name: string; city: string }>(),
    supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle<{ full_name: string }>(),
  ]);
  const { data: creatorRow } = task.created_by
    ? await supabase
        .from("profiles")
        .select("employee_id")
        .eq("id", task.created_by)
        .maybeSingle<{ employee_id: string | null }>()
    : { data: null };
  const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : task.store_id;
  const employeeLabel = employeeRow?.full_name ?? "Сотрудник";

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: task.store_id,
    p_event_type: "task_completed",
    p_title: "Задача выполнена",
    p_body: `${employeeLabel} · ${storeLabel} · ${task.title}`,
    p_related_entity_type: "task",
    p_related_entity_id: taskId,
  });

  const creatorEmployeeId = creatorRow?.employee_id ?? null;

  if (creatorEmployeeId && creatorEmployeeId !== employeeId) {
    await supabase.rpc("send_employee_notification", {
      p_employee_id: creatorEmployeeId,
      p_event_type: "task_completed",
      p_title: "Задача выполнена",
      p_body: `${employeeLabel} · ${storeLabel} · ${task.title}`,
      p_related_entity_type: "task",
      p_related_entity_id: taskId,
    });
  }

  await dispatchPushNotificationsFromEvent(supabase, {
    eventType: "task_completed",
    relatedEntityType: "task",
    relatedEntityId: taskId,
  }).catch(() => null);

  if (task.created_by) {
    await dispatchPushNotificationsFromEvent(supabase, {
      eventType: "task_completed",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      recipientProfileId: task.created_by,
    }).catch(() => null);
  }

  return NextResponse.redirect(tasksUrl(request, "task-done"), 303);
}


