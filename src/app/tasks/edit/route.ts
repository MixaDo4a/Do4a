import { NextRequest, NextResponse } from "next/server";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function redirectToTasks(request: NextRequest, message: string) {
  const url = new URL("/tasks", request.url);
  url.searchParams.set("message", message);
  return NextResponse.redirect(url, 303);
}
function field(formData: FormData, name: string) { return String(formData.get(name) ?? "").trim(); }

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const taskId = field(formData, "task_id");
  const title = field(formData, "title");
  const description = field(formData, "description");
  const dueAt = field(formData, "due_at");
  const priority = field(formData, "priority") || "normal";
  if (!taskId || !title || !["low", "normal", "high", "urgent"].includes(priority)) return redirectToTasks(request, "task-error");
  let dueAtIso: string | null = null;
  if (dueAt) { const parsedDueAt = new Date(dueAt); if (Number.isNaN(parsedDueAt.getTime())) return redirectToTasks(request, "task-error"); dueAtIso = parsedDueAt.toISOString(); }
  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.redirect(new URL("/login", request.url), 303);
  const { roles } = await getCurrentRoleCodes();
  if (!roles.some((role) => ["manager", "store_manager", "super_admin", "developer"].includes(role))) return redirectToTasks(request, "task-error");
  const accessibleStoreIds = new Set((await getAccessibleStores()).map((store) => store.id));
  const { data: task, error: taskError } = await supabase.from("tasks").select("id,store_id,task_type,status").eq("id", taskId).maybeSingle();
  if (taskError || !task || !accessibleStoreIds.has(task.store_id) || task.task_type !== "ordinary" || !["open", "in_progress", "overdue"].includes(task.status)) return redirectToTasks(request, "task-error");
  const { error } = await supabase.from("tasks").update({ title, description: description || null, due_at: dueAtIso, priority, updated_at: new Date().toISOString() }).eq("id", taskId);
  return redirectToTasks(request, error ? "task-error" : "task-updated");
}
