import { BottomNavClient } from "@/components/bottom-nav-client";
import { getCurrentRoleCodes } from "@/lib/auth/roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function BottomNav() {
  const { roles, user } = await getCurrentRoleCodes();
  const supabase = await createSupabaseServerClient();
  const { count } = user
    ? await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("recipient_profile_id", user.id)
        .eq("is_read", false)
    : { count: 0 };

  return <BottomNavClient roles={roles} unreadCount={count ?? 0} />;
}
