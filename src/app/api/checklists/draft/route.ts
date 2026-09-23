import { NextRequest, NextResponse } from "next/server";
import { CHECKLIST_ROLES, getCurrentRoleCodes, hasAnyRole } from "@/lib/auth/roles";
import { getAccessibleStores } from "@/lib/auth/stores";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type DraftPayload = {
  scores?: Record<string, number>;
  comments?: Record<string, string>;
  comment?: string;
};

function isPayload(value: unknown): value is DraftPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as DraftPayload;
  return (
    (!payload.scores || typeof payload.scores === "object") &&
    (!payload.comments || typeof payload.comments === "object") &&
    (!payload.comment || typeof payload.comment === "string")
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { roles } = await getCurrentRoleCodes();
  if (!hasAnyRole(roles, CHECKLIST_ROLES)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  let body: { templateId?: string; storeId?: string; employeeId?: string; payload?: DraftPayload };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const templateId = String(body.templateId ?? "").trim();
  const storeId = String(body.storeId ?? "").trim();
  const employeeId = String(body.employeeId ?? "").trim();
  if (!templateId || !storeId || !employeeId || !isPayload(body.payload)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const accessibleStores = await getAccessibleStores();
  if (!accessibleStores.some((store) => store.id === storeId)) {
    return NextResponse.json({ error: "store_access_denied" }, { status: 403 });
  }

  const { error } = await supabase.from("checklist_drafts").upsert(
    {
      profile_id: user.id,
      template_id: templateId,
      store_id: storeId,
      employee_id: employeeId,
      payload: body.payload,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,template_id,store_id,employee_id" },
  );

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ saved: true });
}

export async function DELETE(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const templateId = String(body.templateId ?? "").trim();
  const storeId = String(body.storeId ?? "").trim();
  const employeeId = String(body.employeeId ?? "").trim();
  if (!templateId || !storeId || !employeeId) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const { error } = await supabase
    .from("checklist_drafts")
    .delete()
    .eq("profile_id", user.id)
    .eq("template_id", templateId)
    .eq("store_id", storeId)
    .eq("employee_id", employeeId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ deleted: true });
}
