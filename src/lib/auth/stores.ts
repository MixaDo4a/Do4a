import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentEmployeeId, getCurrentRoleCodes } from "@/lib/auth/roles";

export type AccessibleStoreRow = {
  id: string;
  name: string;
  city: string;
};

export async function getAccessibleStores() {
  const supabase = await createSupabaseServerClient();
  const { roles } = await getCurrentRoleCodes();
  const { employeeId } = await getCurrentEmployeeId();
  const isDeveloper = roles.includes("developer");
  const isSuperAdmin = roles.includes("super_admin");

  if (isDeveloper || isSuperAdmin) {
    const { data, error } = await supabase.rpc("admin_list_accessible_stores");

    if (!error && data) {
      return data as AccessibleStoreRow[];
    }

    const { data: storesData, error: storesError } = await supabase.from("stores").select("id, name, city").order("city").order("name");

    if (!storesError && storesData) {
      return storesData as AccessibleStoreRow[];
    }
  }

  if (!employeeId) {
    return [] as AccessibleStoreRow[];
  }

  const { data, error } = await supabase
    .from("employee_store_assignments")
    .select("stores(id, name, city)")
    .eq("employee_id", employeeId)
    .or(`valid_to.is.null,valid_to.gte.${new Date().toISOString().slice(0, 10)}`);

  if (error || !data) {
    return [] as AccessibleStoreRow[];
  }

  return (data
    .map((row) => (Array.isArray(row.stores) ? row.stores[0] : row.stores))
    .filter(Boolean) as AccessibleStoreRow[]).filter((store, index, list) => list.findIndex((item) => item.id === store.id) === index);
}
