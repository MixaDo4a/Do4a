import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProfileRow = { id: string; employee_id: string | null };
type RoleRow = { profile_id: string; roles: { code: string } | { code: string }[] | null };

export async function getScheduleEmployeeIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<Set<string>> {
  const { data: roleRows, error: rolesError } = await supabase
    .from("user_roles")
    .select("profile_id, roles(code)")
    .is("revoked_at", null)
    .returns<RoleRow[]>();

  if (rolesError) throw new Error(rolesError.message);
  const profileIds = [...new Set((roleRows ?? [])
    .filter((row) => {
      const roles = Array.isArray(row.roles) ? row.roles : row.roles ? [row.roles] : [];
      return roles.some((role) => role.code === "manager" || role.code === "store_manager");
    })
    .map((row) => row.profile_id))];
  if (profileIds.length === 0) return new Set();

  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, employee_id")
    .in("id", profileIds)
    .returns<ProfileRow[]>();

  if (profilesError) throw new Error(profilesError.message);
  return new Set((profiles ?? []).flatMap((profile) => profile.employee_id ? [profile.employee_id] : []));
}
