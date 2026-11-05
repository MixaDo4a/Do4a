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
import { cleanText } from "@/lib/display";
import { advanceTaskRecurrenceRun, type TaskRecurrenceFrequency } from "@/lib/task-recurrence";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function tasksUrl(request: NextRequest, message: string, detail?: string) {
  const requestUrl = new URL(request.url);
  const dashboardReturn = requestUrl.searchParams.get("returnTo") === "dashboard";
  const url = new URL(dashboardReturn ? "/dashboard" : "/tasks", request.url);
  const period = requestUrl.searchParams.get("period");
  if (dashboardReturn && period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    url.searchParams.set("period", period);
  }
  url.searchParams.set("message", message);

  if (detail) {
    url.searchParams.set("detail", detail);
  }

  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const taskType = value(formData, "task_type") || "ordinary";
  let storeIds = Array.from(
    new Set(
      formData.getAll(taskType === "expiration" ? "campaign_store_ids" : "store_ids")
        .map((entry) => String(entry).trim())
        .filter(Boolean),
    ),
  );
  const fallbackStoreId = value(formData, "store_id");
  if (storeIds.length === 0 && fallbackStoreId) {
    storeIds.push(fallbackStoreId);
  }
  const rawAssigneeEmployeeIds = Array.from(new Set([
    ...formData.getAll("assignee_employee_ids").map((entry) => String(entry).trim()),
    value(formData, "assignee_employee_id"),
  ].filter(Boolean)));
  const storeWideTask = rawAssigneeEmployeeIds.includes("__store_all__");
  const assigneeEmployeeIds = rawAssigneeEmployeeIds.filter((id) => id !== "__store_all__");
  const assigneeEmployeeId = assigneeEmployeeIds[0] ?? "";
  const title = value(formData, "title");
  const description = value(formData, "description");
  const dueAt = value(formData, "due_at");
  const priority = value(formData, "priority") || "normal";
  const recurrenceFrequency = value(formData, "recurrence_frequency");
  const ordinarySubtaskTitles = value(formData, "ordinary_subtasks")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (taskType === "ordinary" && (storeIds.length === 0 || (!storeWideTask && assigneeEmployeeIds.length === 0) || !title)) {
    return NextResponse.redirect(tasksUrl(request, "task-required"), 303);
  }
  if (taskType === "expiration" && (!value(formData, "product_name") || !value(formData, "expiry_date"))) {
    return NextResponse.redirect(tasksUrl(request, "task-required", "Укажите товар, срок годности и магазины."), 303);
  }
  if (taskType !== "ordinary" && taskType !== "expiration") {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Неизвестный тип задачи."), 303);
  }

  if (taskType === "ordinary" && (title.length > 200 || description.length > 5000 || ordinarySubtaskTitles.length > 20 || ordinarySubtaskTitles.some((item) => item.length > 240))) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Допустимо не более 20 подзадач длиной до 240 символов."), 303);
  }

  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный приоритет задачи."), 303);
  }

  const recurrenceEnabled = recurrenceFrequency && recurrenceFrequency !== "none";
  const isValidRecurrenceFrequency = ["daily", "weekly", "monthly"].includes(recurrenceFrequency);
  if (recurrenceFrequency && recurrenceFrequency !== "none" && !isValidRecurrenceFrequency) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректный интервал повторения задачи."), 303);
  }

  let dueAtIso: string | null = null;
  if (dueAt) {
    const dueAtDate = new Date(dueAt);
    if (Number.isNaN(dueAtDate.getTime())) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Некорректная дата задачи."), 303);
    }
    dueAtIso = dueAtDate.toISOString();
  }

  if (recurrenceEnabled && !dueAtIso) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Для повторяющейся задачи укажите дату и время первого запуска."), 303);
  }

  if (storeWideTask && recurrenceEnabled) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Для задачи на магазин повторение пока недоступно."), 303);
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
  if (taskType === "expiration") {
    if (accessibleStoreIds.size === 0) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "У вас нет доступных магазинов для сроковой кампании."), 303);
    }
    const { data: campaignStores, error: storesError } = await supabase
      .from("stores")
      .select("id,is_warehouse")
      .in("id", [...accessibleStoreIds])
      .eq("status", "active")
      .returns<{ id: string; is_warehouse: boolean }[]>();
    if (storesError) return NextResponse.redirect(tasksUrl(request, "task-error", storesError.message), 303);
    storeIds = (campaignStores ?? []).filter((store) => !store.is_warehouse).map((store) => store.id);
  }
  if (taskType === "expiration" && storeIds.length === 0) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "У вас нет доступных магазинов для сроковой кампании."), 303);
  }
  if (storeIds.some((storeId) => !accessibleStoreIds.has(storeId))) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Можно ставить задачи только по доступным магазинам."), 303);
  }

  if (taskType === "expiration") {
    const productName = value(formData, "product_name");
    const expiryDate = value(formData, "expiry_date");
    const discountType = value(formData, "discount_type");
    const discountValue = Number(value(formData, "discount_value").replace(",", "."));
    const auditorEmployeeId = value(formData, "auditor_employee_id");
    const marketerEmployeeId = value(formData, "marketer_employee_id");
    const extraSubtasks = value(formData, "extra_subtasks").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryDate) || !Number.isFinite(discountValue) ||
      !["percent", "new_price"].includes(discountType) || extraSubtasks.length > 10 || extraSubtasks.some((item) => item.length > 250)) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Проверьте срок, скидку и список подзадач."), 303);
    }
    const { data: selectedStores, error: selectedStoresError } = await supabase.from("stores")
      .select("id,is_warehouse").in("id", storeIds).returns<{ id: string; is_warehouse: boolean }[]>();
    if (selectedStoresError || selectedStores?.length !== storeIds.length || selectedStores.some((store) => store.is_warehouse)) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Склад нельзя включать в сроковую кампанию."), 303);
    }
    const { data: campaignResult, error: campaignError } = await supabase.rpc("create_expiration_task_campaign", {
      p_product_name: productName,
      p_expiry_date: expiryDate,
      p_discount_type: discountType,
      p_discount_value: discountValue,
      p_store_ids: storeIds,
      p_auditor_employee_id: auditorEmployeeId,
      p_marketer_employee_id: marketerEmployeeId,
      p_extra_subtasks: extraSubtasks,
    });
    const campaign = campaignResult as { campaign_id: string; store_task_ids: string[]; auditor_task_id: string; marketer_task_id: string } | null;
    if (campaignError || !campaign) {
      return NextResponse.redirect(tasksUrl(request, "task-error", campaignError?.message ?? "Не удалось создать сроковую кампанию."), 303);
    }
    const createdTaskIds = [...campaign.store_task_ids, campaign.auditor_task_id, campaign.marketer_task_id];
    const [{ data: createdTasks }, { data: storeRows }, { data: employeeRows }] = await Promise.all([
      supabase.from("tasks").select("id,store_id,assignee_employee_id,title").in("id", createdTaskIds)
        .returns<{ id: string; store_id: string; assignee_employee_id: string | null; title: string }[]>(),
      supabase.from("stores").select("id,name,city").in("id", storeIds)
        .returns<{ id: string; name: string; city: string }[]>(),
      supabase.from("employees").select("id,full_name").in("id", [auditorEmployeeId, marketerEmployeeId])
        .returns<{ id: string; full_name: string }[]>(),
    ]);
    const storeById = new Map((storeRows ?? []).map((store) => [store.id, store]));
    const employeeById = new Map((employeeRows ?? []).map((employee) => [employee.id, employee.full_name]));
    await Promise.all((createdTasks ?? []).map(async (task) => {
      const store = storeById.get(task.store_id);
      const storeLabel = store ? `${store.name}, ${store.city}` : "магазин";
      const assigneeName = task.assignee_employee_id ? employeeById.get(task.assignee_employee_id) ?? "Сотрудник" : "";
      if (task.assignee_employee_id) {
        await supabase.rpc("send_employee_notification", {
          p_employee_id: task.assignee_employee_id,
          p_event_type: "new_task",
          p_title: "Сроковая задача",
          p_body: `${cleanText(assigneeName, "Сотрудник")} · ${storeLabel} · ${task.title}`,
          p_related_entity_type: "task",
          p_related_entity_id: task.id,
        });
      } else {
        await supabase.rpc("send_store_employees_notification", {
          p_store_id: task.store_id,
          p_event_type: "new_task",
          p_title: "Сроковая задача",
          p_body: `${storeLabel} · ${task.title}`,
          p_exclude_profile_id: user.id,
          p_related_entity_type: "task",
          p_related_entity_id: task.id,
        });
      }
      await supabase.rpc("send_store_managers_notification", {
        p_store_id: task.store_id,
        p_event_type: "new_task",
        p_title: "Сроковая задача",
        p_body: `${storeLabel} · ${task.title}`,
        p_exclude_profile_id: user.id,
        p_related_entity_type: "task",
        p_related_entity_id: task.id,
      });
      await dispatchPushNotificationsFromEvent(supabase, { eventType: "new_task", relatedEntityType: "task", relatedEntityId: task.id }).catch(() => null);
    }));
    return NextResponse.redirect(tasksUrl(request, "task-created"), 303);
  }

  const taskPairs = storeWideTask
    ? storeIds.map((storeId) => ({ store_id: storeId, employee_id: null as string | null }))
    : storeIds.flatMap((storeId) => assigneeEmployeeIds.map((employeeId) => ({ store_id: storeId, employee_id: employeeId })));

  const duplicateWindowStart = new Date(Date.now() - 15_000).toISOString();
  let duplicateQuery = supabase
    .from("tasks")
    .select("id")
    .in("store_id", storeIds)
    .eq("title", title)
    .eq("priority", priority)
    .eq("status", "open")
    .gte("created_at", duplicateWindowStart);
  duplicateQuery = storeWideTask
    ? duplicateQuery.is("assignee_employee_id", null)
    : duplicateQuery.in("assignee_employee_id", assigneeEmployeeIds);
  const { data: duplicateTasks, error: duplicateError } = await duplicateQuery.returns<{ id: string }[]>();

  if (duplicateError) {
    return NextResponse.redirect(tasksUrl(request, "task-error", duplicateError.message), 303);
  }

  if ((duplicateTasks ?? []).length > 0) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Похоже, такая задача уже была создана только что."), 303);
  }

  const { data: assigneeStoreAssignment, error: assigneeStoreError } = !storeWideTask
    ? await supabase
        .from("employee_store_assignments")
        .select("employee_id, store_id")
        .in("employee_id", assigneeEmployeeIds)
        .in("store_id", storeIds)
        .lte("valid_from", new Date().toISOString().slice(0, 10))
        .or(`valid_to.is.null,valid_to.gte.${new Date().toISOString().slice(0, 10)}`)
        .returns<{ employee_id: string; store_id: string }[]>()
    : { data: [], error: null };

  if (!storeWideTask && (assigneeStoreError || assigneeEmployeeIds.some((id) => (assigneeStoreAssignment ?? []).filter((row) => row.employee_id === id).length !== storeIds.length))) {
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

  const recurrenceDueAt = recurrenceEnabled
    ? advanceTaskRecurrenceRun(new Date(dueAtIso as string), recurrenceFrequency as TaskRecurrenceFrequency).toISOString()
    : null;

  const recurrenceRuleRows = recurrenceEnabled
    ? taskPairs.map(({ store_id: storeId, employee_id: assigneeId }) => ({
        store_id: storeId,
        assignee_employee_id: assigneeId,
        title,
        description: description || null,
        frequency: recurrenceFrequency,
        next_run_at: recurrenceDueAt,
        created_by: user.id,
      }))
    : [];

  let recurrenceRuleIdsByKey = new Map<string, string>();
  if (recurrenceEnabled) {
    const { data: recurrenceRules, error: recurrenceError } = await supabase
      .from("task_recurrence_rules")
      .insert(recurrenceRuleRows)
      .select("id, store_id, assignee_employee_id")
      .returns<{ id: string; store_id: string; assignee_employee_id: string }[]>();

    if (recurrenceError || !recurrenceRules) {
      return NextResponse.redirect(tasksUrl(request, "task-error", recurrenceError?.message ?? "Не удалось создать правило повторения задачи."), 303);
    }

    recurrenceRuleIdsByKey = new Map(recurrenceRules.map((rule) => [`${rule.store_id}_${rule.assignee_employee_id}`, rule.id]));
  }

  const taskRows = taskPairs.map(({ store_id: storeId, employee_id: assigneeId }) => ({
    store_id: storeId,
    assignee_employee_id: assigneeId,
    created_by: user.id,
    title,
    description: description || null,
    due_at: dueAtIso,
    priority,
    status: "open" as const,
    recurrence_rule_id: recurrenceRuleIdsByKey.get(`${storeId}_${assigneeId}`) ?? null,
  }));

  const { data, error } = await supabase
    .from("tasks")
    .insert(taskRows)
    .select("id, store_id, assignee_employee_id")
    .returns<{ id: string; store_id: string; assignee_employee_id: string | null }[]>();

  if (error || !data) {
    if (recurrenceEnabled) {
      await supabase.from("task_recurrence_rules").delete().in("store_id", storeIds).eq("assignee_employee_id", assigneeEmployeeId).eq("title", title);
    }
    return NextResponse.redirect(tasksUrl(request, "task-error", error?.message), 303);
  }

  let subtaskWarning: string | undefined;
  if (ordinarySubtaskTitles.length > 0) {
    const { error: subtaskError } = await supabase.rpc("create_ordinary_task_subtasks", {
      p_task_ids: data.map((task) => task.id),
      p_titles: ordinarySubtaskTitles,
    });
    if (subtaskError) {
      subtaskWarning = `Основные задачи созданы, но подзадачи сохранить не удалось: ${subtaskError.message}`;
    }
  }

  const [{ data: storeRows }, { data: employeeRow }, { data: assigneeRows }] = await Promise.all([
    supabase.from("stores").select("id, name, city").in("id", storeIds).returns<{ id: string; name: string; city: string }[]>(),
    employeeId
      ? supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle<{ full_name: string }>()
      : Promise.resolve({ data: null, error: null }),
    assigneeEmployeeIds.length > 0
      ? supabase.from("employees").select("id, full_name").in("id", assigneeEmployeeIds).returns<{ id: string; full_name: string }[]>()
      : Promise.resolve({ data: [] as { id: string; full_name: string }[], error: null }),
  ]);
  const storeRowById = new Map((storeRows ?? []).map((storeRow) => [storeRow.id, storeRow]));
  const authorLabel = employeeRow?.full_name ?? "Сотрудник";
  const assigneeNameById = new Map((assigneeRows ?? []).map((row) => [row.id, row.full_name]));
  await Promise.all(
    data.map(async (task) => {
      const storeRow = storeRowById.get(task.store_id);
      const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : task.store_id;
      const assigneeLabel = task.assignee_employee_id ? assigneeNameById.get(task.assignee_employee_id) ?? "Сотрудник" : "не выбрано";
      const taskBody = `${assigneeLabel} · ${storeLabel} · ${title}`;

      if (!storeWideTask && task.assignee_employee_id) {
        await supabase.rpc("send_employee_notification", {
          p_employee_id: task.assignee_employee_id,
          p_event_type: "new_task",
          p_title: "Новая задача",
          p_body: taskBody,
          p_related_entity_type: "task",
          p_related_entity_id: task.id,
        });
      }

      await supabase.rpc("send_store_managers_notification", {
        p_store_id: task.store_id,
        p_event_type: "new_task",
        p_title: "Новая задача",
        p_body: `${authorLabel} поставил задачу на магазин ${storeLabel}: ${title}`,
        p_exclude_profile_id: user.id,
        p_related_entity_type: "task",
        p_related_entity_id: task.id,
      });

      if (!storeWideTask) await supabase.rpc("send_store_employees_notification", {
        p_store_id: task.store_id,
        p_event_type: "new_task",
        p_title: "Новая задача",
        p_body: taskBody,
        p_exclude_employee_id: assigneeEmployeeId,
        p_exclude_profile_id: user.id,
        p_related_entity_type: "task",
        p_related_entity_id: task.id,
      });

      await dispatchPushNotificationsFromEvent(supabase, {
        eventType: "new_task",
        relatedEntityType: "task",
        relatedEntityId: task.id,
      }).catch(() => null);
    }),
  );

  return NextResponse.redirect(tasksUrl(request, "task-created", subtaskWarning), 303);
}


