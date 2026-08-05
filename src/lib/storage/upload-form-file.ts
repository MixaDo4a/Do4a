import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

function safeFileName(name: string) {
  return (
    name
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "file"
  );
}

function inferMimeType(fileName: string, fallback: string | null) {
  const extension = fileName.split(".").pop()?.toLowerCase();

  if (extension === "xlsx") {
    return "application/vnd.ms-excel";
  }

  if (fallback === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
    return "application/vnd.ms-excel";
  }

  if (fallback) {
    return fallback;
  }

  switch (extension) {
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "xls":
      return "application/vnd.ms-excel";
    case "xlsx":
      return "application/vnd.ms-excel";
    default:
      return null;
  }
}

export async function uploadFormFile(
  supabase: SupabaseClient,
  bucket: string,
  folder: string,
  file: File,
  uploadedBy: string,
  relatedEntityType: string,
  relatedEntityId: string | null,
) {
  if (!file || file.size === 0) {
    return null;
  }

  const path = `${folder}/${randomUUID()}-${safeFileName(file.name)}`;
  const contentType = inferMimeType(file.name, file.type || null);
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: contentType || undefined,
    upsert: false,
  });

  if (uploadError) {
    throw new Error(uploadError.message);
  }

  const { data, error } = await supabase
    .from("files")
    .insert({
      bucket,
      path,
      mime_type: contentType,
      size_bytes: file.size,
      uploaded_by: uploadedBy,
      related_entity_type: relatedEntityType,
      related_entity_id: relatedEntityId,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(error?.message ?? "Не удалось сохранить файл.");
  }

  return data.id;
}
