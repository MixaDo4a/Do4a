import { NextRequest, NextResponse } from "next/server";
import { getCurrentEmployeeId, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { dispatchPushNotificationsFromEvent } from "@/lib/push";
import { getCompletionPhotoType } from "@/lib/tasks/completion-photo";

function tasksUrl(request: NextRequest, message: string, detail?: string) {
  const url = new URL("/tasks", request.url);
  url.searchParams.set("message", message);
  if (detail) url.searchParams.set("detail", detail);
  return url;
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const taskId = String(formData.get("task_id") ?? "").trim();

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
    .select("id, assignee_employee_id, store_id, title, created_by, task_type, requires_completion_photo")
    .eq("id", taskId)
    .maybeSingle<{ id: string; assignee_employee_id: string | null; store_id: string; title: string; created_by: string | null; task_type: string; requires_completion_photo: boolean }>();

  if (readError || !task) {
    return NextResponse.redirect(tasksUrl(request, "task-error", readError?.message ?? "Задача не найдена."), 303);
  }

  const canAccessStore = (await getAccessibleStores(supabase)).some((store) => store.id === task.store_id);
  if (!canManageTasks && task.assignee_employee_id !== employeeId && !canAccessStore) {
    return NextResponse.redirect(tasksUrl(request, "task-error", "Недостаточно прав для изменения задачи."), 303);
  }

  if (task.task_type === "expiration_store" || task.task_type === "expiration_checker") {
    const outcome = String(formData.get("completion_outcome") ?? "").trim();
    const completionComment = String(formData.get("completion_comment") ?? "").trim();
    const { data: completionResult, error: completionError } = await supabase.rpc("set_expiration_task_completion", {
      p_task_id: taskId,
      p_outcome: outcome,
      p_comment: completionComment,
    });
    const completion = completionResult as { task_type: string; outcome: string } | null;
    if (completionError || !completion) return NextResponse.redirect(tasksUrl(request, "task-error", completionError?.message ?? "Не удалось завершить сроковую задачу."), 303);
    if (task.created_by) {
      const { data: creator } = await supabase.from("profiles").select("employee_id").eq("id", task.created_by).maybeSingle<{ employee_id: string | null }>();
      if (creator?.employee_id && creator.employee_id !== employeeId) {
        const detail = completion.outcome === "writeoff" ? `Часть товара отмечена к списанию: ${completionComment}` : completion.outcome === "distributed" ? `Остатки распределены: ${completionComment}` : "Весь товар распродан.";
        await supabase.rpc("send_employee_notification", {
          p_employee_id: creator.employee_id,
          p_event_type: "task_completed",
          p_title: "Сроковая задача выполнена",
          p_body: `${task.title}. ${detail}`,
          p_related_entity_type: "task",
          p_related_entity_id: taskId,
        });
        await dispatchPushNotificationsFromEvent(supabase, {
          eventType: "task_completed",
          relatedEntityType: "task",
          relatedEntityId: taskId,
          recipientProfileId: task.created_by,
        }).catch(() => null);
      }
    }
    return NextResponse.redirect(tasksUrl(request, "task-done"), 303);
  }

  let uploadedPhotoPath: string | null = null;
  if (task.task_type === "ordinary" && task.requires_completion_photo) {
    if (!employeeId) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Для выполнения задачи требуется профиль сотрудника."), 303);
    }
    if (task.assignee_employee_id && task.assignee_employee_id !== employeeId) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Фото должен приложить сотрудник, которому назначена задача."), 303);
    }
    if (!task.assignee_employee_id) {
      const { data: assignment } = await supabase.from("employee_store_assignments")
        .select("id")
        .eq("employee_id", employeeId)
        .eq("store_id", task.store_id)
        .lte("valid_from", new Date().toISOString().slice(0, 10))
        .or(`valid_to.is.null,valid_to.gte.${new Date().toISOString().slice(0, 10)}`)
        .limit(1)
        .maybeSingle<{ id: string }>();
      if (!assignment) {
        return NextResponse.redirect(tasksUrl(request, "task-error", "Фото должен приложить сотрудник, закреплённый за магазином задачи."), 303);
      }
    }
    const photo = formData.get("completion_photo");
    if (!(photo instanceof File) || photo.size === 0) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Для выполнения этой задачи приложите фото."), 303);
    }
    const photoType = await getCompletionPhotoType(photo);
    if (!photoType) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Поддерживаются JPEG, PNG или WebP размером до 4 МБ."), 303);
    }
    const storagePath = `${task.id}/${crypto.randomUUID()}.${photoType.extension}`;
    const { error: uploadError } = await supabase.storage.from("task-completion-photos").upload(storagePath, photo, {
      contentType: photoType.mime,
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadError) {
      return NextResponse.redirect(tasksUrl(request, "task-error", "Не удалось загрузить фото. Попробуйте ещё раз."), 303);
    }
    const { error: metadataError } = await supabase.from("task_completion_photos").insert({
      task_id: task.id,
      storage_path: storagePath,
      mime_type: photoType.mime,
      size_bytes: photo.size,
      uploaded_by: employeeId,
    });
    if (metadataError) {
      await supabase.storage.from("task-completion-photos").remove([storagePath]);
      return NextResponse.redirect(tasksUrl(request, "task-error", "Не удалось сохранить фото задачи."), 303);
    }
    uploadedPhotoPath = storagePath;
  }

  const { data, error } = await supabase.rpc("set_store_task_status", {
    p_task_id: taskId,
    p_status: "done",
  }).single<{ id: string; created_by: string | null }>();

  if (error || !data) {
    if (uploadedPhotoPath) {
      await supabase.storage.from("task-completion-photos").remove([uploadedPhotoPath]);
      await supabase.from("task_completion_photos").delete().eq("task_id", task.id);
    }
    return NextResponse.redirect(tasksUrl(request, "task-error", error?.message ?? "Задача не найдена или уже обработана."), 303);
  }

  const [{ data: storeRow }, { data: employeeRow }] = await Promise.all([
    supabase.from("stores").select("name, city").eq("id", task.store_id).maybeSingle<{ name: string; city: string }>(),
    supabase.from("employees").select("full_name").eq("id", employeeId).maybeSingle<{ full_name: string }>(),
  ]);
  const { data: creatorRow } = task.created_by
    ? await supabase
        .from("profiles")
        .select("employee_id")
        .eq("id", task.created_by)
        .maybeSingle<{ employee_id: string | null }>()
    : { data: null };
  const storeLabel = storeRow ? `${storeRow.name}, ${storeRow.city}` : task.store_id;
  const employeeLabel = employeeRow?.full_name ?? "Сотрудник";

  await supabase.rpc("send_store_managers_notification", {
    p_store_id: task.store_id,
    p_event_type: "task_completed",
    p_title: "Задача выполнена",
    p_body: `${employeeLabel} · ${storeLabel} · ${task.title}`,
    p_related_entity_type: "task",
    p_related_entity_id: taskId,
  });

  const creatorEmployeeId = creatorRow?.employee_id ?? null;

  if (creatorEmployeeId && creatorEmployeeId !== employeeId) {
    await supabase.rpc("send_employee_notification", {
      p_employee_id: creatorEmployeeId,
      p_event_type: "task_completed",
      p_title: "Задача выполнена",
      p_body: `${employeeLabel} · ${storeLabel} · ${task.title}`,
      p_related_entity_type: "task",
      p_related_entity_id: taskId,
    });
  }

  await dispatchPushNotificationsFromEvent(supabase, {
    eventType: "task_completed",
    relatedEntityType: "task",
    relatedEntityId: taskId,
  }).catch(() => null);

  if (task.created_by) {
    await dispatchPushNotificationsFromEvent(supabase, {
      eventType: "task_completed",
      relatedEntityType: "task",
      relatedEntityId: taskId,
      recipientProfileId: task.created_by,
    }).catch(() => null);
  }

  return NextResponse.redirect(tasksUrl(request, "task-done"), 303);
}


