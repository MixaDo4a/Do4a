import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes, hasAnyRole, MANAGE_ROLES, TASK_CREATOR_ROLES } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function redirectToTasks(request: NextRequest, message: string) {
  const url = new URL("/tasks", request.url);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url, 303);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const taskId = value(formData, "task_id");
  const title = value(formData, "title");
  const description = value(formData, "description");
  const dueAt = value(formData, "due_at");
  const priority = value(formData, "priority") || "normal";
  if (!taskId || !title || !["low", "normal", "high", "urgent"].includes(priority)) return redirectToTasks(request, "task-error");

  let dueAtIso: string | null = null;
  if (dueAt) {
    const date = new Date(dueAt);
    if (Number.isNaN(date.getTime())) return redirectToTasks(request, "task-error");
    dueAtIso = date.toISOString();
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { roles } = await getCurrentRoleCodes(supabase, user);
  if (!hasAnyRole(roles, TASK_CREATOR_ROLES)) return redirectToTasks(request, "task-error");

  const accessibleStores = await getAccessibleStores(supabase);
  const { data: task, error: taskError } = await supabase.from("tasks").select("id,store_id,created_by,recurrence_rule_id,status,task_type").eq("id", taskId).maybeSingle<{
    id: string; store_id: string; created_by: string | null; recurrence_rule_id: string | null; status: string; task_type: string;
  }>();
  const canManage = hasAnyRole(roles, MANAGE_ROLES);
  if (taskError || !task || task.task_type !== "ordinary" || task.status === "done" || task.status === "cancelled" || !accessibleStores.some((store) => store.id === task.store_id) || (!canManage && task.created_by !== user.id)) {
    return redirectToTasks(request, "task-error");
  }

  const { error } = await supabase.from("tasks").update({ title, description: description || null, due_at: dueAtIso, priority }).eq("id", taskId);
  if (error) return redirectToTasks(request, "task-error");
  if (task.recurrence_rule_id) {
    await supabase.from("task_recurrence_rules").update({ title, description: description || null }).eq("id", task.recurrence_rule_id);
  }
  return redirectToTasks(request, "task-updated");
}
