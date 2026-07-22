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
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type || undefined,
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
      mime_type: file.type || null,
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
