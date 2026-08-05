import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function createSupabaseAuthClient(token: string | null) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase environment variables are missing");
  }

  return createClient(url, anonKey, {
    global: token
      ? {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      : undefined,
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

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

  const authClient = bearerToken ? createSupabaseAuthClient(bearerToken) : await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await authClient.auth.getUser();

  const userAgent = body.userAgent ?? request.headers.get("user-agent") ?? null;

  if (userError || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let deactivateQuery = authClient
    .from("push_subscriptions")
    .update({ is_active: false })
    .eq("profile_id", user.id)
    .eq("is_active", true)
    .neq("endpoint", body.endpoint);

  if (userAgent) {
    deactivateQuery = deactivateQuery.eq("user_agent", userAgent);
  }

  const { error: deactivateError } = await deactivateQuery;

  if (deactivateError) {
    return NextResponse.json({ error: deactivateError.message }, { status: 400 });
  }

  const { error } = await authClient.from("push_subscriptions").upsert(
    {
      profile_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      expiration_time: body.expirationTime ? new Date(body.expirationTime).toISOString() : null,
      user_agent: userAgent,
      is_active: true,
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
