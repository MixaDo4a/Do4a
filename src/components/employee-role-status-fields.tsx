"use client";

import { useMemo, useState } from "react";

export type EmployeeRoleCode =
  | "manager"
  | "auditor"
  | "store_manager"
  | "warehouse_manager"
  | "warehouse_assistant"
  | "super_admin"
  | "developer";

type Props = {
  assignableRoleCodes: EmployeeRoleCode[];
  currentRoleCode?: EmployeeRoleCode | null;
  defaultRoleCode?: EmployeeRoleCode | "";
  defaultStatus?: "padawan" | "experienced";
  keepCurrentOption?: boolean;
  roleLabels: Record<EmployeeRoleCode, string>;
};

export function EmployeeRoleStatusFields({
  assignableRoleCodes,
  currentRoleCode = null,
  defaultRoleCode = "",
  defaultStatus = "padawan",
  keepCurrentOption = false,
  roleLabels,
}: Props) {
  const initialRole = useMemo(() => {
    if (defaultRoleCode) return defaultRoleCode;
    if (keepCurrentOption) return "";
    return assignableRoleCodes.includes("manager") ? "manager" : assignableRoleCodes[0] ?? "";
  }, [assignableRoleCodes, defaultRoleCode, keepCurrentOption]);
  const [selectedRole, setSelectedRole] = useState<EmployeeRoleCode | "">(initialRole);
  const effectiveRole = selectedRole || currentRoleCode;
  const showManagerStatus = effectiveRole === "manager";

  return (
    <>
      <select
        className="h-10 rounded-md border border-line px-3"
        name="employee_role"
        value={selectedRole}
        onChange={(event) => setSelectedRole(event.target.value as EmployeeRoleCode | "")}
        required={!keepCurrentOption}
      >
        {keepCurrentOption ? <option value="">Не менять должность</option> : <option value="">Должность</option>}
        {assignableRoleCodes.map((code) => (
          <option key={code} value={code}>
            {roleLabels[code]}
          </option>
        ))}
      </select>

      {showManagerStatus ? (
        <select className="h-10 rounded-md border border-line px-3" name="employee_status" defaultValue={defaultStatus}>
          <option value="padawan">Падаван</option>
          <option value="experienced">Бывалый</option>
        </select>
      ) : (
        <input name="employee_status" type="hidden" value={defaultStatus} />
      )}
    </>
  );
}
