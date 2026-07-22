export type UserRole =
  | "manager"
  | "auditor"
  | "store_manager"
  | "buyer"
  | "warehouse_manager"
  | "warehouse_assistant"
  | "super_admin"
  | "developer";

export type EmployeeStatus = "padawan" | "experienced";

export type ShiftStatus = "planned" | "opened" | "closed" | "auto_closed" | "cancelled" | "correction_required";

export type ShiftParticipantRole = "primary_seller" | "secondary_seller";
