"use client";

import { useMemo, useState } from "react";

export type EmployeeRoleCode =
  | "manager"
  | "auditor"
  | "store_manager"
  | "buyer"
  | "warehouse_manager"
  | "warehouse_assistant"
  | "super_admin"
  | "developer";

type Props = {
  assignableRoleCodes: EmployeeRoleCode[];
  currentRoleCodes?: EmployeeRoleCode[];
  defaultRoleCodes?: EmployeeRoleCode[];
  defaultStatus?: "padawan" | "experienced";
  roleLabels: Record<EmployeeRoleCode, string>;
};

export function EmployeeRoleStatusFields({
  assignableRoleCodes,
  currentRoleCodes = [],
  defaultRoleCodes = [],
  defaultStatus = "padawan",
  roleLabels,
}: Props) {
  const initialRoles = useMemo<EmployeeRoleCode[]>(() => defaultRoleCodes.length > 0 ? defaultRoleCodes : assignableRoleCodes.includes("manager") ? ["manager"] : assignableRoleCodes.slice(0, 1), [assignableRoleCodes, defaultRoleCodes]);
  const [selectedRoles, setSelectedRoles] = useState<EmployeeRoleCode[]>(initialRoles);
  const effectiveRoles = selectedRoles.length > 0 ? selectedRoles : currentRoleCodes;
  const showManagerStatus = effectiveRoles.includes("manager");

  return (
    <>
      <fieldset className="grid gap-2 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-medium">Роли сотрудника</legend>
        {assignableRoleCodes.map((code) => (
          <label key={code} className="flex items-center gap-2 text-sm">
            <input
              checked={selectedRoles.includes(code)}
              className="h-4 w-4 accent-brand"
              name="employee_roles"
              onChange={(event) => setSelectedRoles((current) => event.target.checked ? [...current, code] : current.filter((role) => role !== code))}
              type="checkbox"
              value={code}
            />
            <span>{roleLabels[code]}</span>
          </label>
        ))}
      </fieldset>

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
