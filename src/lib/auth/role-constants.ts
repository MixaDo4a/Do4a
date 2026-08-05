export const ROLE_HIERARCHY = [
  "developer",
  "super_admin",
  "store_manager",
  "buyer",
  "warehouse_manager",
  "auditor",
  "warehouse_assistant",
  "manager",
] as const;

export const CHECKLIST_ROLES = ["auditor", "store_manager", "super_admin", "developer"];
export const MANAGE_ROLES = ["store_manager", "super_admin", "developer"];
export const OPEN_SHIFT_ROLES = ["manager", "store_manager", "super_admin", "developer"];
export const TASK_CREATOR_ROLES = ["store_manager", "super_admin", "developer", "warehouse_manager", "warehouse_assistant"];
export const DEDUCTION_ROLES = ["store_manager", "super_admin", "developer", "warehouse_manager"];
export const PROCUREMENT_ROLES = ["manager", "auditor", "store_manager", "buyer", "warehouse_manager", "super_admin", "developer"];
export const PROCUREMENT_MANAGE_ROLES = ["buyer", "warehouse_manager", "super_admin", "developer"];
