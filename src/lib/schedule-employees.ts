import { createSupabaseServerClient } from "@/lib/supabase/server";

type RoleRow = { profiles: { employee_id: string | null } | null };

export async function getScheduleEmployeeIds(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): Promise<Set<string>> {
  const { data: roleRows, error } = await supabase
    .from("user_roles")
    .select("profiles!inner(employee_id), roles!inner(code)")
    .is("revoked_at", null)
    .in("roles.code", ["manager", "store_manager"])
    .returns<RoleRow[]>();

  if (error) throw new Error(error.message);
  return new Set((roleRows ?? []).flatMap((row) => row.profiles?.employee_id ? [row.profiles.employee_id] : []));
}
