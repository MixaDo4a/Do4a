import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId, getCurrentRoleCodes } from "@/lib/auth/roles";

export type AccessibleStoreRow = {
  id: string;
  name: string;
  city: string;
};

export type CurrentEmployeeScope = {
  employeeId: string | null;
  city: string | null;
  roles: string[];
  isDeveloper: boolean;
};

export async function getCurrentEmployeeScope(): Promise<CurrentEmployeeScope> {
  const supabase = await createSupabaseServerClient();
  const { roles } = await getCurrentRoleCodes();
  const { employeeId } = await getCurrentEmployeeId();

  if (!employeeId) {
    return {
      employeeId: null,
      city: null,
      roles,
      isDeveloper: roles.includes("developer"),
    };
  }

  const { data } = await supabase.from("employees").select("city").eq("id", employeeId).maybeSingle<{ city: string | null }>();

  return {
    employeeId,
    city: data?.city ?? null,
    roles,
    isDeveloper: roles.includes("developer"),
  };
}

export async function getAccessibleStores() {
  const supabase = await createSupabaseServerClient();
  const scope = await getCurrentEmployeeScope();

  if (scope.isDeveloper) {
    const { data, error } = await supabase.rpc("admin_list_accessible_stores");

    if (!error && data) {
      return data as AccessibleStoreRow[];
    }

    const { data: storesData, error: storesError } = await supabase.from("stores").select("id, name, city").order("city").order("name");

    if (!storesError && storesData) {
      return storesData as AccessibleStoreRow[];
    }
  }

  if (!scope.employeeId) {
    return [] as AccessibleStoreRow[];
  }

  const { data, error } = await supabase
    .from("employee_store_assignments")
    .select("stores(id, name, city)")
    .eq("employee_id", scope.employeeId)
    .or(`valid_to.is.null,valid_to.gte.${new Date().toISOString().slice(0, 10)}`);

  if (error || !data) {
    return [] as AccessibleStoreRow[];
  }

  const employeeCity = scope.city?.trim().toLowerCase() ?? "";

  return (data
    .map((row) => (Array.isArray(row.stores) ? row.stores[0] : row.stores))
    .filter(Boolean) as AccessibleStoreRow[])
    .filter((store) => !employeeCity || store.city.trim().toLowerCase() === employeeCity)
    .filter((store, index, list) => list.findIndex((item) => item.id === store.id) === index);
}
