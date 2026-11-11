import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
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

  const [{ roles }, accessibleStores, { data: task, error: readError }] = await Promise.all([
    getCurrentRoleCodes(supabase, user),
    getAccessibleStores(supabase),
    supabase.from("tasks")
      .select("id,store_id,created_by,source_checklist_submission_id,task_type,status,stores(timezone)")
      .eq("id", taskId)
      .maybeSingle<{
        id: string;
        store_id: string;
        created_by: string | null;
        source_checklist_submission_id: string | null;
        task_type: string;
        status: string;
        stores: { timezone: string | null } | null;
      }>(),
  ]);
  const isCreator = task?.created_by === user.id;
  const isManagerChecklistTask = Boolean(
    task
      && roles.includes("store_manager")
      && task.source_checklist_submission_id
      && accessibleStores.some((store) => store.id === task.store_id),
  );
  if (readError || !task || (!isCreator && !isManagerChecklistTask) || task.task_type !== "ordinary" || !["open", "in_progress", "overdue"].includes(task.status)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Редактировать можно только свою активную обычную задачу или активную задачу из чек-листа своего магазина."), 303);
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
