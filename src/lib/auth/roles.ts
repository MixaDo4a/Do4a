import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  CHECKLIST_ROLES,
  DEDUCTION_ROLES,
  MANAGE_ROLES,
  OPEN_SHIFT_ROLES,
  PROCUREMENT_MANAGE_ROLES,
  PROCUREMENT_ROLES,
  ROLE_HIERARCHY,
  TASK_CREATOR_ROLES,
} from "@/lib/auth/role-constants";

export type RoleRelation<T extends string = string> = { code: T } | { code: T }[] | null;

export function roleCodeFromRelation<T extends string = string>(relation: RoleRelation<T>) {
  return Array.isArray(relation) ? relation[0]?.code ?? null : relation?.code ?? null;
}

export async function getCurrentRoleCodes() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, roles: [] as string[] };
  }

  const { data, error } = await supabase
    .from("user_roles")
    .select("roles(code)")
    .eq("profile_id", user.id)
    .is("revoked_at", null)
    .returns<{ roles: RoleRelation }[]>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    user,
    roles: data.map((row) => roleCodeFromRelation(row.roles)).filter((role): role is string => Boolean(role)),
  };
}

export async function getCurrentEmployeeId() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, employeeId: null as string | null };
  }

  const { data, error } = await supabase.from("profiles").select("employee_id").eq("id", user.id).maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return { user, employeeId: data?.employee_id ?? null };
}

export function hasAnyRole(roles: string[], allowed: string[]) {
  return roles.some((role) => allowed.includes(role));
}

export function roleRank(role: string) {
  const index = ROLE_HIERARCHY.indexOf(role as (typeof ROLE_HIERARCHY)[number]);
  return index === -1 ? ROLE_HIERARCHY.length : index;
}

export function canAssignRole(currentRole: string, targetRole: string) {
  return roleRank(targetRole) >= roleRank(currentRole);
}

export function canManageTargetRole(currentRole: string, targetRole: string) {
  return roleRank(targetRole) >= roleRank(currentRole);
}

export function canDeleteTargetRole(currentRole: string, targetRole: string) {
  if (currentRole === "developer") {
    return true;
  }

  return roleRank(targetRole) > roleRank(currentRole);
}

export { CHECKLIST_ROLES, DEDUCTION_ROLES, MANAGE_ROLES, OPEN_SHIFT_ROLES, PROCUREMENT_MANAGE_ROLES, PROCUREMENT_ROLES, ROLE_HIERARCHY, TASK_CREATOR_ROLES };
