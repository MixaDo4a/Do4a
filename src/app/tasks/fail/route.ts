import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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
  const canManageTasks = hasAnyRole(roles, MANAGE_ROLES);
  const { data: task, error: readError } = await supabase
    .from("tasks")
    .select("id, assignee_employee_id, store_id")
    .eq("id", taskId)
    .maybeSingle<{ id: string; assignee_employee_id: string; store_id: string }>();

  if (readError || !task) {
    return NextResponse.redirect(tasksUrl(request, "task-error", readError?.message ?? "Задача не найдена."), 303);
  }

  if (!canManageTasks && task.assignee_employee_id !== employeeId) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Недостаточно прав для изменения задачи."), 303);
  }

  const { data, error: taskError } = await supabase
    .from("tasks")
    .update({ status: "overdue" })
    .eq("id", taskId)
    .select("id")
    .maybeSingle();

  if (taskError || !data) {
    return NextResponse.redirect(
      tasksUrl(request, "task-error", taskError?.message ?? "Задача не найдена или уже обработана."),
      303,
    );
  }

  const { error: commentError } = await supabase.from("task_comments").insert({
    task_id: taskId,
    author_profile_id: user.id,
    body: comment,
  });

  if (commentError) {
    return NextResponse.redirect(tasksUrl(request, "task-error", commentError.message), 303);
  }

  await supabase.rpc("send_employee_notification", {
    p_employee_id: task.assignee_employee_id,
    p_event_type: "task_overdue",
    p_title: "Задача просрочена",
    p_body: comment,
    p_related_entity_type: "task",
    p_related_entity_id: taskId,
  });

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: task.store_id,
    p_event_type: "task_overdue",
    p_title: "Задача просрочена",
    p_body: comment,
    p_related_entity_type: "task",
    p_related_entity_id: taskId,
  });

  await supabase.rpc("send_store_employees_notification", {
    p_store_id: task.store_id,
    p_event_type: "task_overdue",
    p_title: "Задача просрочена",
    p_body: comment,
    p_exclude_employee_id: task.assignee_employee_id,
    p_related_entity_type: "task",
    p_related_entity_id: taskId,
  });

  return NextResponse.redirect(tasksUrl(request, "task-failed"), 303);
}

