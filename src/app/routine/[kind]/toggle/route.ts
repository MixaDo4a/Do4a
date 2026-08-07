import { NextRequest, NextResponse } from "next/server";
import { getAccessibleStores } from "@/lib/auth/stores";
import { reviewRoutinePhotoWithOpenAI } from "@/lib/routine-photo-ai";
import { uploadFormFile } from "@/lib/storage/upload-form-file";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";
import type { RoutineKind } from "@/lib/routine";

type TogglePayload = {
  shiftId: string;
  templateItemId: string;
  completed: boolean;
  photo: File | null;
};

async function parsePayload(request: NextRequest): Promise<TogglePayload> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      shiftId: String(formData.get("shiftId") ?? "").trim(),
      templateItemId: String(formData.get("templateItemId") ?? "").trim(),
      completed: String(formData.get("completed") ?? "true").trim() !== "false",
      photo: formData.get("photo") instanceof File ? (formData.get("photo") as File) : null,
    };
  }

  const body = await request.json().catch(() => null);
  return {
    shiftId: String(body?.shiftId ?? "").trim(),
    templateItemId: String(body?.templateItemId ?? "").trim(),
    completed: Boolean(body?.completed ?? true),
    photo: null,
  };
}

async function downloadFileBytes(
  supabase: Awaited<ReturnType<typeof createSupabaseServiceRoleClient>>,
  file: { bucket: string; path: string; mime_type: string | null },
) {
  const { data, error } = await supabase.storage.from(file.bucket).download(file.path);
  if (error || !data) {
    throw new Error(error?.message ?? "Не удалось загрузить файл.");
  }

  return {
    bytes: await data.arrayBuffer(),
    mimeType: file.mime_type,
  };
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (kind !== "morning" && kind !== "evening") {
    return NextResponse.json({ error: "Invalid routine kind" }, { status: 400 });
  }

  const { shiftId, templateItemId, completed, photo } = await parsePayload(request);
  if (!shiftId || !templateItemId) {
    return NextResponse.json({ error: "Missing routine payload" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [shiftResult, accessibleStores] = await Promise.all([
    supabase
      .from("shifts")
      .select("id, store_id, opened_by_employee_id, shift_date, status")
      .eq("id", shiftId)
      .maybeSingle<{ id: string; store_id: string; opened_by_employee_id: string; shift_date: string; status: string }>(),
    getAccessibleStores(),
  ]);
  const { data: shiftRow, error: shiftError } = shiftResult;

  if (shiftError) {
    return NextResponse.json({ error: shiftError.message }, { status: 400 });
  }

  if (!shiftRow) {
    return NextResponse.json({ error: "Shift not found" }, { status: 404 });
  }

  if (!accessibleStores.some((store) => store.id === shiftRow.store_id)) {
    return NextResponse.json({ error: "Store is not accessible" }, { status: 403 });
  }

  const [
    { data: templateItem, error: templateItemError },
    { data: templateRow, error: templateError },
    { data: employeeRow },
    { data: storeRow },
  ] = await Promise.all([
    supabase
      .from("day_routine_template_items")
      .select("id, template_id, title")
      .eq("id", templateItemId)
      .maybeSingle<{ id: string; template_id: string; title: string }>(),
    supabase
      .from("day_routine_templates")
      .select("id, store_id, routine_kind, title")
      .eq("store_id", shiftRow.store_id)
      .eq("routine_kind", kind)
      .eq("is_active", true)
      .maybeSingle<{ id: string; store_id: string; routine_kind: string; title: string }>(),
    supabase.from("employees").select("id, full_name").eq("id", shiftRow.opened_by_employee_id).maybeSingle<{ id: string; full_name: string }>(),
    supabase.from("stores").select("id, name, city").eq("id", shiftRow.store_id).maybeSingle<{ id: string; name: string; city: string }>(),
  ]);

  if (templateItemError) {
    return NextResponse.json({ error: templateItemError.message }, { status: 400 });
  }

  if (templateError) {
    return NextResponse.json({ error: templateError.message }, { status: 400 });
  }

  if (!templateItem || !templateRow || templateItem.template_id !== templateRow.id) {
    return NextResponse.json({ error: "Template item not found" }, { status: 404 });
  }

  const templateItemKey = templateItem.id;
  const itemSettingsResult = await supabase
    .from("day_routine_template_item_settings")
    .select(
      "id, template_id, item_key, requires_photo, ai_review_enabled, reference_photo_file_id, reference_photo_file:files(id, bucket, path, mime_type)",
    )
    .eq("template_id", templateRow.id)
    .eq("item_key", templateItemKey)
    .maybeSingle<{
      id: string;
      template_id: string;
      item_key: string;
      requires_photo: boolean;
      ai_review_enabled: boolean;
      reference_photo_file_id: string | null;
      reference_photo_file: { id: string; bucket: string; path: string; mime_type: string | null } | null;
    }>();

  const itemSettings =
    itemSettingsResult.error && /does not exist|Could not find the table|Could not find the relationship/i.test(itemSettingsResult.error.message)
      ? null
      : itemSettingsResult.data;

  if (itemSettingsResult.error && !itemSettings) {
    return NextResponse.json({ error: itemSettingsResult.error.message }, { status: 400 });
  }

  if (completed && itemSettings?.requires_photo && !photo) {
    return NextResponse.json({ error: "Для этого пункта нужно прикрепить фото." }, { status: 400 });
  }

  const serviceSupabase = createSupabaseServiceRoleClient();
  let uploadedFileId: string | null = null;

  if (completed && photo) {
    uploadedFileId = await uploadFormFile(
      serviceSupabase,
      "routine-photos",
      `sessions/${shiftId}/${kind}/${templateItemKey}`,
      photo,
      user.id,
      "day_routine_session_item_photo",
      null,
    );
  }

  const { data: result, error: toggleError } = await supabase.rpc("toggle_day_routine_item_completion", {
    p_shift_id: shiftId,
    p_routine_kind: kind as RoutineKind,
    p_template_item_id: templateItemId,
    p_completed: completed,
  });

  if (toggleError) {
    return NextResponse.json({ error: toggleError.message }, { status: 400 });
  }

  if (completed && uploadedFileId) {
    const { data: sessionItem, error: sessionItemError } = await serviceSupabase
      .from("day_routine_session_items")
      .select("id")
      .eq("session_id", String(result?.session_id ?? ""))
      .eq("template_item_id", templateItemId)
      .maybeSingle<{ id: string }>();

    if (sessionItemError || !sessionItem) {
      return NextResponse.json(
        { error: sessionItemError?.message ?? "Не удалось найти пункт распорядка." },
        { status: 400 },
      );
    }

    const { data: insertedPhoto, error: photoInsertError } = await serviceSupabase
      .from("day_routine_session_item_photos")
      .insert({
        session_item_id: sessionItem.id,
        file_id: uploadedFileId,
        uploaded_by: user.id,
      })
      .select("id")
      .single<{ id: string }>();

    if (photoInsertError) {
      return NextResponse.json({ error: photoInsertError.message }, { status: 400 });
    }

    let reviewStatus: "approved" | "needs_attention" | "manual_review" | "error" = "manual_review";
    let reviewComment: string | null = null;
    let reviewPayload: Record<string, unknown> | null = null;

    if (itemSettings?.ai_review_enabled && itemSettings.reference_photo_file_id) {
      try {
        const { data: templateReferenceFile, error: templateReferenceError } = await serviceSupabase
          .from("files")
          .select("id, bucket, path, mime_type")
          .eq("id", itemSettings.reference_photo_file_id)
          .maybeSingle<{ id: string; bucket: string; path: string; mime_type: string | null }>();

        const { data: employeePhotoFile, error: employeePhotoError } = await serviceSupabase
          .from("files")
          .select("id, bucket, path, mime_type")
          .eq("id", uploadedFileId)
          .maybeSingle<{ id: string; bucket: string; path: string; mime_type: string | null }>();

        if (templateReferenceError || !templateReferenceFile || employeePhotoError || !employeePhotoFile) {
          throw new Error(templateReferenceError?.message ?? employeePhotoError?.message ?? "Не удалось подготовить фото для проверки.");
        }

        const [templatePhoto, employeePhoto] = await Promise.all([
          downloadFileBytes(serviceSupabase, templateReferenceFile),
          downloadFileBytes(serviceSupabase, employeePhotoFile),
        ]);

        const review = await reviewRoutinePhotoWithOpenAI({
          employeePhoto,
          templatePhoto,
          routineTitle: templateRow.title,
          itemTitle: templateItem.title,
          storeLabel: storeRow ? `${storeRow.name}, ${storeRow.city}` : shiftRow.store_id,
        });

        reviewStatus = review.approved ? "approved" : "needs_attention";
        reviewComment = review.summary;
        reviewPayload = review as unknown as Record<string, unknown>;

        if (!review.approved) {
          const feedback = [review.summary, ...review.issues].filter(Boolean).join(" · ");
          await Promise.all([
            supabase.rpc("send_employee_notification", {
              p_employee_id: shiftRow.opened_by_employee_id,
              p_event_type: "day_routine_photo_needs_attention",
              p_title: "Нужно исправить фото распорядка",
              p_body: `${employeeRow?.full_name ?? "Сотрудник"} · ${templateRow.title} · ${templateItem.title}. ${feedback}`.trim(),
              p_related_entity_type: "routine",
              p_related_entity_id: String(result?.session_id ?? shiftId),
            }),
            supabase.rpc("send_store_managers_notification", {
              p_store_id: shiftRow.store_id,
              p_event_type: "day_routine_photo_needs_attention",
              p_title: "Фото распорядка требует внимания",
              p_body: `${employeeRow?.full_name ?? "Сотрудник"} · ${templateRow.title} · ${templateItem.title}. ${feedback}`.trim(),
              p_related_entity_type: "routine",
              p_related_entity_id: String(result?.session_id ?? shiftId),
            }),
          ]);
        }
      } catch (error) {
        reviewStatus = "error";
        reviewComment = error instanceof Error ? error.message : "Не удалось проверить фото.";
        reviewPayload = {
          error: reviewComment,
        };
      }
    }

    const { error: reviewInsertError } = await serviceSupabase.from("day_routine_item_photo_reviews").insert({
      session_item_photo_id: insertedPhoto?.id ?? null,
      template_reference_file_id: itemSettings?.reference_photo_file_id ?? null,
      review_status: reviewStatus,
      review_comment: reviewComment,
      review_payload: reviewPayload,
      reviewed_by: "openai",
    });

    if (reviewInsertError) {
      return NextResponse.json({ error: reviewInsertError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, result });
}
