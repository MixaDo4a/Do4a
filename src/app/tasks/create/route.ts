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
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

  if (!storeId || !assigneeEmployeeId || !title) {
    return NextResponse.redirect(tasksUrl(request, "task-required"), 303);
  }

  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный приоритет задачи."), 303);
  }

  let dueAtIso: string | null = null;
  if (dueAt) {
    const dueAtDate = new Date(dueAt);
    if (Number.isNaN(dueAtDate.getTime())) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректная дата задачи."), 303);
    }
    dueAtIso = dueAtDate.toISOString();
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
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.redirect(tasksUrl(request, "task-error", error?.message), 303);
  }

  await supabase.rpc("send_employee_notification", {
    p_employee_id: assigneeEmployeeId,
    p_event_type: "new_task",
    p_title: "Новая задача",
    p_body: title,
    p_related_entity_type: "task",
    p_related_entity_id: data.id,
  });

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: storeId,
    p_event_type: "new_task",
    p_title: "Новая задача",
    p_body: title,
    p_related_entity_type: "task",
    p_related_entity_id: data.id,
  });

  await supabase.rpc("send_store_employees_notification", {
    p_store_id: storeId,
    p_event_type: "new_task",
    p_title: "Новая задача",
    p_body: title,
    p_exclude_employee_id: assigneeEmployeeId,
    p_related_entity_type: "task",
    p_related_entity_id: data.id,
  });

  return NextResponse.redirect(tasksUrl(request, "task-created"), 303);
}

