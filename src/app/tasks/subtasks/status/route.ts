import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

function tasksUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/tasks", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const subtaskId = String(form.get("subtask_id") ?? "").trim();
  const status = String(form.get("status") ?? "").trim();
  const comment = String(form.get("comment") ?? "").trim();
  if (!subtaskId || !["open", "done"].includes(status)) return NextResponse.redirect(tasksUrl(request, "task-error"), 303);

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { employeeId } = await getCurrentEmployeeId(supabase, user);
  const { data: result, error } = await supabase.rpc("set_task_subtask_status", {
    p_subtask_id: subtaskId,
    p_status: status,
    p_comment: comment,
  });
  const data = result as { task_id: string; created_by: string; store_id: string; assignee_employee_id: string | null; parent_completed: boolean; task_type: string } | null;
  if (error || !data) return NextResponse.redirect(tasksUrl(request, "task-error", error?.message ?? "Подзадача недоступна."), 303);

  const [{ data: subtask }, { data: store }, { data: actor }] = await Promise.all([
    supabase.from("task_subtasks").select("title").eq("id", subtaskId).maybeSingle<{ title: string }>(),
    supabase.from("stores").select("name,city").eq("id", data.store_id).maybeSingle<{ name: string; city: string }>(),
    employeeId ? supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle<{ full_name: string }>() : Promise.resolve({ data: null, error: null }),
  ]);
  const { data: creatorProfile } = await supabase.from("profiles").select("employee_id").eq("id", data.created_by).maybeSingle<{ employee_id: string | null }>();
  const creatorEmployeeId = creatorProfile?.employee_id;
  const employeeName = actor?.full_name ?? "Сотрудник";
  const storeName = store ? `${store.name}, ${store.city}` : "магазин";

  if (status === "done" && creatorEmployeeId && creatorEmployeeId !== employeeId) {
    await supabase.rpc("send_employee_notification", {
      p_employee_id: creatorEmployeeId,
      p_event_type: "task_completed",
      p_title: data.parent_completed ? "Подзадача и сроковая задача выполнены" : "Подзадача выполнена",
      p_body: `${employeeName} · ${storeName} · ${subtask?.title ?? "Подзадача"}${data.parent_completed ? ". Все обязательные подзадачи маркетинга закрыты." : ""}`,
      p_related_entity_type: "task",
      p_related_entity_id: data.task_id,
    });
    await dispatchPushNotificationsFromEvent(supabase, {
      eventType: "task_completed",
      relatedEntityType: "task",
      relatedEntityId: data.task_id,
      recipientProfileId: data.created_by,
    }).catch(() => null);
  } else if (status === "open") {
    const notice = `Подзадача «${subtask?.title ?? "Подзадача"}» требует доработки. Комментарий: ${comment}`;
    if (data.assignee_employee_id) {
      await supabase.rpc("send_employee_notification", {
        p_employee_id: data.assignee_employee_id,
        p_event_type: "task_overdue",
        p_title: "Подзадачу возобновили",
        p_body: notice,
        p_related_entity_type: "task",
        p_related_entity_id: data.task_id,
      });
    } else {
      await supabase.rpc("send_store_employees_notification", {
        p_store_id: data.store_id,
        p_event_type: "task_overdue",
        p_title: "Подзадачу возобновили",
        p_body: notice,
        p_exclude_profile_id: user.id,
        p_related_entity_type: "task",
        p_related_entity_id: data.task_id,
      });
    }
  }
  const destination = status === "open" ? "/tasks" : data.parent_completed ? "/tasks/archive" : "/tasks";
  const redirectUrl = new URL(destination, request.url);
  redirectUrl.searchParams.set("storeId", data.store_id);
  redirectUrl.searchParams.set("message", status === "done" ? "task-done" : "task-reopened");
  return NextResponse.redirect(redirectUrl, 303);
}
