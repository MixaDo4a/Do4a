import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export const runtime = "nodejs";
export const maxDuration = 60;

type ExpiredPhoto = { id: string; storage_path: string | null };

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseServiceRoleClient();
  let deleted = 0;

  for (let page = 0; page < 10; page += 1) {
    const { data: photos, error } = await supabase
      .from("task_completion_photos")
      .select("id,storage_path")
      .is("deleted_at", null)
      .lte("expires_at", new Date().toISOString())
      .limit(100)
      .returns<ExpiredPhoto[]>();

    if (error) return NextResponse.json({ error: "cleanup_query_failed" }, { status: 500 });
    if (!photos?.length) break;

    const paths = photos.flatMap((photo) => photo.storage_path ? [photo.storage_path] : []);
    if (paths.length) {
      const { error: removeError } = await supabase.storage.from("task-completion-photos").remove(paths);
      if (removeError) return NextResponse.json({ error: "cleanup_storage_failed" }, { status: 500 });
    }

    const { error: updateError } = await supabase
      .from("task_completion_photos")
      .update({ storage_path: null, deleted_at: new Date().toISOString() })
      .in("id", photos.map((photo) => photo.id));
    if (updateError) return NextResponse.json({ error: "cleanup_metadata_failed" }, { status: 500 });

    deleted += photos.length;
    if (photos.length < 100) break;
  }

  return NextResponse.json({ ok: true, deleted });
}
