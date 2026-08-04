import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/service-role";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        endpoint?: string;
        expirationTime?: number | null;
        keys?: { p256dh?: string; auth?: string };
        userAgent?: string;
      }
    | null;

  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return NextResponse.json({ error: "invalid-subscription" }, { status: 400 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : null;

  const authClient = await createSupabaseServerClient();
  const {
    data: { user: cookieUser },
  } = await authClient.auth.getUser();

  let user = cookieUser;
  if (!user && bearerToken) {
    const { data, error } = await authClient.auth.getUser(bearerToken);
    if (!error) {
      user = data.user;
    }
  }

  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let writer;
  try {
    writer = createSupabaseServiceRoleClient();
  } catch {
    writer = authClient;
  }

  const { error } = await writer.from("push_subscriptions").upsert(
    {
      profile_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      expiration_time: body.expirationTime ? new Date(body.expirationTime).toISOString() : null,
      user_agent: body.userAgent ?? request.headers.get("user-agent"),
      is_active: true,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
