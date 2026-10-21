import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

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
  const taskId = String(formData.get("task_id") ?? "").trim();
  const comment = String(formData.get("comment") ?? "").trim() || "Задача не выполнена.";

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
  const canManageTasks = hasAnyRole(roles, ["developer", "super_admin"]);
  const { data: task, error: readError } = await supabase
    .from("tasks")
    .select("id, assignee_employee_id, store_id")
    .eq("id", taskId)
    .maybeSingle<{ id: string; assignee_employee_id: string | null; store_id: string }>();

  if (readError || !task) {
    return NextResponse.redirect(tasksUrl(request, "task-error", readError?.message ?? "Задача не найдена."), 303);
  }

  const canAccessStore = (await getAccessibleStores(supabase)).some((store) => store.id === task.store_id);
  if (!canManageTasks && task.assignee_employee_id !== employeeId && !canAccessStore) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Недостаточно прав для изменения задачи."), 303);
  }

  const { data, error: taskError } = await supabase.rpc("set_store_task_status", {
    p_task_id: taskId,
    p_status: "overdue",
    p_comment: comment,
  }).single<{ id: string }>();

  if (taskError || !data) {
    return NextResponse.redirect(
      tasksUrl(request, "task-error", taskError?.message ?? "Задача не найдена или уже обработана."),
      303,
    );
  }

  const [{ data: storeRow }, { data: employeeRow }] = await Promise.all([
    supabase.from("stores").select("name, city").eq("id", task.store_id).maybeSingle<{ name: string; city: string }>(),
    supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle<{ full_name: string }>(),
  ]);
  const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : task.store_id;
  const employeeLabel = employeeRow?.full_name ?? "Сотрудник";
  const commentBody = `${employeeLabel} · ${storeLabel} · ${comment}`;

  if (task.assignee_employee_id) {
    await supabase.rpc("send_employee_notification", {
      p_employee_id: task.assignee_employee_id,
      p_event_type: "task_overdue",
      p_title: "Задача просрочена",
      p_body: commentBody,
      p_related_entity_type: "task",
      p_related_entity_id: taskId,
    });
  }

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: task.store_id,
    p_event_type: "task_overdue",
    p_title: "Задача просрочена",
    p_body: commentBody,
    p_related_entity_type: "task",
    p_related_entity_id: taskId,
  });

  await supabase.rpc("send_store_employees_notification", {
    p_store_id: task.store_id,
    p_event_type: "task_overdue",
    p_title: "Задача просрочена",
    p_body: commentBody,
    p_exclude_employee_id: task.assignee_employee_id,
    p_related_entity_type: "task",
    p_related_entity_id: taskId,
  });

  await dispatchPushNotificationsFromEvent(supabase, {
    eventType: "task_overdue",
    relatedEntityType: "task",
    relatedEntityId: taskId,
  }).catch(() => null);

  return NextResponse.redirect(tasksUrl(request, "task-failed"), 303);
}


