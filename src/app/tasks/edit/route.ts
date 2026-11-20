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
  const storeId = String(form.get("store_id") ?? "").trim();
  const assigneeEmployeeId = String(form.get("assignee_employee_id") ?? "").trim() || null;
  const dueAt = String(form.get("due_at") ?? "").trim();
  const priority = String(form.get("priority") ?? "normal");
  const subtaskTitles = String(form.get("subtasks") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

  if (!taskId || !storeId || !title || title.length > 200 || description.length > 5000 || subtaskTitles.length > 20 || subtaskTitles.some((item) => item.length > 240)) {
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
  const accessibleStoreIds = new Set(accessibleStores.map((store) => store.id));
  const isManagerChecklistTask = Boolean(
    task
      && roles.includes("store_manager")
      && task.source_checklist_submission_id
      && accessibleStoreIds.has(task.store_id),
  );
  if (readError || !task || (!isCreator && !isManagerChecklistTask) || !accessibleStoreIds.has(storeId) || task.task_type !== "ordinary" || !["open", "in_progress", "overdue"].includes(task.status)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Редактировать можно только свою активную обычную задачу или активную задачу из чек-листа своего магазина."), 303);
  }

  const dueAtIso = dueAt ? parseStoreDateTimeLocalInput(dueAt, task.stores?.timezone) : null;
  if (dueAt && !dueAtIso) return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный срок задачи."), 303);

  if (assigneeEmployeeId) {
    const today = new Date().toISOString().slice(0, 10);
    const [{ data: employee, error: employeeError }, { data: assignment, error: assignmentError }] = await Promise.all([
      supabase.from("employees").select("id").eq("id", assigneeEmployeeId).eq("is_active", true).maybeSingle(),
      supabase.from("employee_store_assignments").select("employee_id").eq("employee_id", assigneeEmployeeId).eq("store_id", storeId)
        .lte("valid_from", today).or(`valid_to.is.null,valid_to.gte.${today}`).limit(1).maybeSingle(),
    ]);
    if (employeeError || assignmentError || !employee || !assignment) return NextResponse.redirect(tasksUrl(request, "task-error", "Ответственный должен быть активным сотрудником выбранного магазина."), 303);
  }

  const { data, error } = await supabase.rpc("update_ordinary_task_with_assignment", {
    p_task_id: taskId,
    p_title: title,
    p_description: description,
    p_due_at: dueAtIso,
    p_priority: priority,
    p_subtask_titles: subtaskTitles,
    p_store_id: storeId,
    p_assignee_employee_id: assigneeEmployeeId,
  });
  if (error || data !== true) {
    return NextResponse.redirect(tasksUrl(request, "task-error", error?.message ?? "Задача не обновлена."), 303);
  }
  return NextResponse.redirect(tasksUrl(request, "task-updated"), 303);
}
