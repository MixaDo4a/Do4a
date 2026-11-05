import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseStoreDateTimeLocalInput } from "@/lib/timezone";

function tasksUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/tasks", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const taskId = String(form.get("task_id") ?? "").trim();
  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const dueAt = String(form.get("due_at") ?? "").trim();
  const priority = String(form.get("priority") ?? "normal");
  const subtaskTitles = String(form.get("subtasks") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

  if (!taskId || !title || title.length > 200 || description.length > 5000 || subtaskTitles.length > 20 || subtaskTitles.some((item) => item.length > 240)) {
    return NextResponse.redirect(tasksUrl(request, "task-required"), 303);
  }
  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный приоритет."), 303);
  }

  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url), 303);

  const { data: task, error: readError } = await supabase.from("tasks")
    .select("id,created_by,task_type,status,stores(timezone)")
    .eq("id", taskId)
    .maybeSingle<{ id: string; created_by: string | null; task_type: string; status: string; stores: { timezone: string | null } | null }>();
  if (readError || !task || task.created_by !== user.id || task.task_type !== "ordinary" || !["open", "in_progress", "overdue"].includes(task.status)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Редактировать можно только свою активную обычную задачу."), 303);
  }

  const dueAtIso = dueAt ? parseStoreDateTimeLocalInput(dueAt, task.stores?.timezone) : null;
  if (dueAt && !dueAtIso) return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный срок задачи."), 303);

  const { data, error } = await supabase.rpc("update_ordinary_task_by_creator", {
    p_task_id: taskId,
    p_title: title,
    p_description: description,
    p_due_at: dueAtIso,
    p_priority: priority,
    p_subtask_titles: subtaskTitles,
  });
  if (error || data !== true) {
    return NextResponse.redirect(tasksUrl(request, "task-error", error?.message ?? "Задача не обновлена."), 303);
  }
  return NextResponse.redirect(tasksUrl(request, "task-updated"), 303);
}
