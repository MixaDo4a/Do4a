import { NextRequest, NextResponse } from "next/server";
import { getAccessibleStores } from "@/lib/auth/stores";
import { ensureStorageBucket } from "@/lib/storage/ensure-storage-bucket";
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

  const { data: templateItem, error: templateItemError } = await supabase
    .from("day_routine_template_items")
    .select("id, template_id, title")
    .eq("id", templateItemId)
    .maybeSingle<{ id: string; template_id: string; title: string }>();

  if (templateItemError) {
    return NextResponse.json({ error: templateItemError.message }, { status: 400 });
  }

  if (!templateItem) {
    return NextResponse.json({ error: "Template item not found" }, { status: 404 });
  }

  const { data: templateRow, error: templateError } = await supabase
    .from("day_routine_templates")
    .select("id, store_id")
    .eq("id", templateItem.template_id)
    .eq("store_id", shiftRow.store_id)
    .eq("routine_kind", kind)
    .eq("is_active", true)
    .maybeSingle<{ id: string; store_id: string }>();

  if (templateError) {
    return NextResponse.json({ error: templateError.message }, { status: 400 });
  }

  if (!templateRow) {
    return NextResponse.json({ error: "Template item not found" }, { status: 404 });
  }

  const itemSettingsResult = await supabase
    .from("day_routine_template_item_settings")
    .select("id, requires_photo")
    .eq("template_id", templateRow.id)
    .eq("item_key", templateItem.id)
    .maybeSingle<{ id: string; requires_photo: boolean }>();

  const itemSettings = itemSettingsResult.error && /does not exist|Could not find the table|Could not find the relationship/i.test(itemSettingsResult.error.message)
    ? null
    : itemSettingsResult.data;

  if (itemSettingsResult.error && !itemSettings) {
    return NextResponse.json({ error: itemSettingsResult.error.message }, { status: 400 });
  }

  if (completed && itemSettings?.requires_photo && !photo) {
    return NextResponse.json({ error: "Для этого пункта нужно прикрепить фото." }, { status: 400 });
  }

  const serviceSupabase = createSupabaseServiceRoleClient();
  await ensureStorageBucket(serviceSupabase, "routine-photos", {
    public: false,
    fileSizeLimit: 25 * 1024 * 1024,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"],
  });
  let uploadedFileId: string | null = null;

  if (completed && photo) {
    uploadedFileId = await uploadFormFile(
      serviceSupabase,
      "routine-photos",
      `sessions/${shiftId}/${kind}/${templateItem.id}`,
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

    const { error: photoInsertError } = await serviceSupabase.from("day_routine_session_item_photos").insert({
      session_item_id: sessionItem.id,
      file_id: uploadedFileId,
      uploaded_by: user.id,
    });

    if (photoInsertError) {
      return NextResponse.json({ error: photoInsertError.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, result });
}
